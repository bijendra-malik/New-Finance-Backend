const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const Franchise = require("../franchise/franchise.model");
const FranchiseCustomer = require("../franchise/franchiseCustomer.model");
const { FranchiseNotificationRead } = require("../franchise/franchiseNotification.model");
const { MODELS } = require("../loans/shared/loanModels");
const { RESOURCE_ROUTES } = require("../loans/shared/adminStatus.service");
const { pushStatusUpdate } = require("./adminUpdate.service");
const { nextFranchiseCode } = require("../../utils/sequence");
const {
  FRANCHISE_STATUS,
  FRANCHISE_STATUS_VALUES,
} = require("../../constants/roles");

/*
==========================================
Admin franchise endpoints.

  listFranchises      GET    /api/admin/franchises
  getFranchiseById    GET    /api/admin/franchises/:id
  setFranchiseStatus  PATCH  /api/admin/franchises/:id/status
  resetFranchisePassword  PATCH  /api/admin/franchises/:id/reset-password
  listFranchiseLoans  GET    /api/admin/franchises/:id/loans

Approving mints the FRN code AND sets the initial password (the franchise's PAN
number, hashed) so the partner can log in with franchiseId + PAN as the password.
==========================================
*/

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const notFound = (message) => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

const conflict = (message) => {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/*
The login details the admin hands to the franchise partner.

Approving mints the FRN code and stores a bcrypt hash of the franchise's PAN
number; that PAN is the first password. This block is therefore rebuilt from the
public fields the admin already sees — never from the stored hash. Returns null
while the application is Pending/Rejected (no FRN code yet).
*/
const buildCredentials = (franchise) => {
  if (!franchise) return null;

  const loginId = franchise.franchiseId || null;
  if (!loginId) return null;

  return {
    loginId,
    password: franchise.panNumber || null,
    passwordIsPan: true,
    note: "Share these with the franchise partner. The password is the PAN number submitted with the application.",
  };
};

/*
Initial password rule (one place, so approve + reset can never drift):

  password = the franchise's PAN number, uppercase, bcrypt-hashed.

The plain PAN is never stored — only this hash.
*/
const hashPanPassword = (franchise) =>
  bcrypt.hash(String(franchise.panNumber).trim().toUpperCase(), 10);

/* The password hash is server-side only — never echo it back in a response. */
const withoutPassword = (franchise) => {
  const safe = franchise.toObject();
  delete safe.password;
  return safe;
};

const buildFranchiseFilter = ({ status, search } = {}) => {
  // The `franchises` collection contains only franchise accounts.
  const filter = {};

  const wantedStatus = String(status ?? "").trim();
  if (wantedStatus) {
    if (!FRANCHISE_STATUS_VALUES.includes(wantedStatus)) {
      throw badRequest(`Status must be one of: ${FRANCHISE_STATUS_VALUES.join(", ")}`);
    }
    filter.franchiseStatus = wantedStatus;
  }

  const q = String(search ?? "").trim();
  if (q) {
    const regex = new RegExp(escapeRegex(q), "i");
    filter.$or = [
      { name: regex },
      { email: regex },
      { mobile: regex },
      { franchiseId: regex },
      { city: regex },
      { state: regex },
    ];
  }

  return filter;
};

const listFranchises = async ({ status, search, page, limit } = {}) => {
  const filter = buildFranchiseFilter({ status, search });
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 0), 100) || 0;
  const pageNumber = Math.max(Number(page) || 1, 1);

  // Trail list payload me nahi (detail endpoint deta hai).
  const query = Franchise.find(filter).select("-adminUpdates").sort({ createdAt: -1 });
  if (safeLimit > 0) query.skip((pageNumber - 1) * safeLimit).limit(safeLimit);

  return query;
};

const countFranchises = async ({ status, search } = {}) =>
  Franchise.countDocuments(buildFranchiseFilter({ status, search }));

const getFranchiseById = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw notFound("Franchise not found");

  const franchise = await Franchise.findOne({ _id: id });
  if (!franchise) throw notFound("Franchise not found");

  return franchise;
};

/*
Ek hi path se status badalta hai — approve/reject bhi isi se jaate hain.
Isliye Approved -> Rejected, Rejected -> Approved ya Pending par wapas le
jaana sab possible hai, aur har change ka audit entry banta hai.
*/
const setFranchiseStatus = async (id, status, req, note) => {
  const next = String(status ?? "").trim();
  if (!FRANCHISE_STATUS_VALUES.includes(next)) {
    throw badRequest(`Status must be one of: ${FRANCHISE_STATUS_VALUES.join(", ")}`);
  }

  const franchise = await getFranchiseById(id);
  if (franchise.franchiseStatus === next) {
    throw conflict(`This franchise is already ${next.toLowerCase()}`);
  }

  const reason = String(note ?? "").trim();

  if (next === FRANCHISE_STATUS.APPROVED) {
    if (!franchise.panNumber) {
      throw badRequest("This application is incomplete — the franchise must submit its details first");
    }
    /* FRN code ek hi baar mint hota hai; re-approve par wahi login ID rehta hai. */
    if (!franchise.franchiseId) franchise.franchiseId = await nextFranchiseCode();
    franchise.password = await hashPanPassword(franchise);
    franchise.franchiseApprovedAt = new Date();
    franchise.franchiseRejectedAt = null;
  } else if (next === FRANCHISE_STATUS.REJECTED) {
    franchise.franchiseRejectedAt = new Date();
  } else {
    franchise.franchiseApprovedAt = null;
    franchise.franchiseRejectedAt = null;
  }

  franchise.franchiseStatus = next;

  /* adminNote rejection reason hi hai — approve/pending par saaf kar dete hain. */
  if (next === FRANCHISE_STATUS.REJECTED) {
    if (reason) {
      franchise.businessDetails = { ...(franchise.businessDetails || {}), adminNote: reason };
    }
  } else if (franchise.businessDetails?.adminNote) {
    franchise.businessDetails = { ...franchise.businessDetails, adminNote: "" };
  }

  const text =
    next === FRANCHISE_STATUS.APPROVED
      ? `Franchise approved${franchise.franchiseId ? ` — login ID ${franchise.franchiseId}` : ""}`
      : next === FRANCHISE_STATUS.REJECTED
        ? `Franchise rejected${reason ? ` — ${reason}` : ""}`
        : "Franchise status changed to Pending";

  /* Decision aur uska audit entry ek hi save me. */
  pushStatusUpdate(franchise, req, {
    entity: "franchise",
    tag: next === FRANCHISE_STATUS.REJECTED ? "flag" : "verification",
    /* Pending koi decision nahi hai — decision enum sirf Approved/Rejected. */
    status: next === FRANCHISE_STATUS.PENDING ? null : next,
    text,
  });

  await franchise.save();

  return withoutPassword(franchise);
};

/*
Re-issue the login password for an already-approved franchise.

Franchises approved before the PAN-password rule have their mobile number
hashed as the password, so the PAN does not work. This rebuilds the hash from
the PAN while keeping the FRN code and approval status intact.
*/
const resetFranchisePassword = async (id) => {
  const franchise = await getFranchiseById(id);

  if (franchise.franchiseStatus !== FRANCHISE_STATUS.APPROVED) {
    throw badRequest("Only an approved franchise has login credentials to reset");
  }

  if (!franchise.panNumber) {
    throw badRequest("This franchise has no PAN number on file, so a password cannot be reset");
  }

  franchise.password = await hashPanPassword(franchise);
  await franchise.save();

  return withoutPassword(franchise);
};

/** How many applications were filed through this franchise, across all products. */
/*
Franchise ne kaunse loan updates padhe — notification keys hi source hain
(`franchise:<id>:loan:<applicationNo>:<status>:<at>`). Isliye har application
par `franchiseViewed` + latest `franchiseViewedAt` derive hota hai, taaki admin
ko franchise detail par pata rahe ki franchise ne update dekha ya nahi.
*/
const franchiseReadState = async (franchiseId) => {
  const receipts = await FranchiseNotificationRead.find({ franchiseId })
    .select("key readAt")
    .lean();

  const viewed = new Map();
  receipts.forEach((row) => {
    const match = /^franchise:[^:]+:loan:([^:]+):/.exec(row.key || "");
    if (!match) return;
    const at = new Date(row.readAt).getTime();
    if (!Number.isFinite(at)) return;
    const current = viewed.get(match[1]);
    if (typeof current !== "number" || at > current) viewed.set(match[1], at);
  });
  return viewed;
};

const withReadState = (applications, viewed) =>
  applications.map((application) => {
    const applicationNo = application.applicationNo || String(application._id);
    const at = viewed.get(applicationNo);
    return {
      ...application.toObject(),
      franchiseViewed: typeof at === "number",
      franchiseViewedAt: typeof at === "number" ? new Date(at).toISOString() : null,
    };
  });

/*
Franchise profile par "6 customers, 1 loan" ka farq clear ho — har registered
customer + uske loan ka product/status (Rejected bhi), taaki koi customer chhoot
na jaye. Sirf is franchise par scoped.
*/
const listFranchiseCustomersSummary = async (franchiseId, limit = 100) => {
  const [customers, total] = await Promise.all([
    FranchiseCustomer.find({ franchise: franchiseId })
      .select("fullName mobile panNumber createdAt")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    FranchiseCustomer.countDocuments({ franchise: franchiseId }),
  ]);

  const byCustomer = new Map();
  await Promise.all(
    Object.entries(MODELS).map(async ([productKey, Model]) => {
      const rows = await Model.find({ franchise: franchiseId })
        .select("franchiseCustomer applicationNo status")
        .lean();
      const label =
        Object.values(RESOURCE_ROUTES).find((route) => route.productKey === productKey)?.label ||
        productKey;
      rows.forEach((row) => {
        if (!row.franchiseCustomer) return;
        const key = String(row.franchiseCustomer);
        const list = byCustomer.get(key) || [];
        list.push({
          product: label,
          applicationNo: row.applicationNo || "",
          status: row.status || "Submitted",
        });
        byCustomer.set(key, list);
      });
    })
  );

  const data = customers.map((customer) => {
    const loans = byCustomer.get(String(customer._id)) || [];
    return {
      _id: customer._id,
      fullName: customer.fullName || "",
      mobile: customer.mobile || "",
      createdAt: customer.createdAt,
      loans,
      loanCount: loans.length,
      rejectedCount: loans.filter((loan) => loan.status === "Rejected").length,
    };
  });

  return { total, data };
};

/** All applications filed through this franchise, grouped per product. */
const listFranchiseLoans = async (id) => {
  const franchise = await getFranchiseById(id);
  const viewed = await franchiseReadState(franchise._id);

  const groups = await Promise.all(
    Object.values(RESOURCE_ROUTES).map(async (entry) => {
      const applications = await MODELS[entry.productKey]
        .find({ franchise: franchise._id })
        .sort({ createdAt: -1 });
      if (!applications.length) return null;
      return {
        product: entry.productKey,
        count: applications.length,
        applications: withReadState(applications, viewed),
      };
    })
  );

  const data = groups.filter(Boolean);
  const total = data.reduce((sum, group) => sum + group.count, 0);

  return {
    franchise: {
      _id: franchise._id,
      name: franchise.name,
      franchiseId: franchise.franchiseId,
      franchiseStatus: franchise.franchiseStatus,
    },
    total,
    data,
  };
};

/*
Super admin hi franchise account permanently hata sakta hai. Franchise doc ke
saath uska notification read state bhi jaata hai, warna orphan receipts bach
ti hain. Franchise ke customers aur unki loan applications financial record
hain — unhe yahan delete nahi kiya jaata.
*/
const deleteFranchise = async (id) => {
  const franchise = await getFranchiseById(id);

  await FranchiseNotificationRead.deleteMany({ franchiseId: franchise._id });
  await franchise.deleteOne();

  return {
    _id: franchise._id,
    name: franchise.name || "",
    franchiseId: franchise.franchiseId || "",
  };
};

module.exports = {
  deleteFranchise,
  listFranchises,
  countFranchises,
  getFranchiseById,
  setFranchiseStatus,
  resetFranchisePassword,
  listFranchiseLoans,
  listFranchiseCustomersSummary,
  buildCredentials,
};
