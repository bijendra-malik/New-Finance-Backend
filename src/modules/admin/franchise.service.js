const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const User = require("../auth/user.model");
const { MODELS } = require("../loans/shared/loanModels");
const { nextFranchiseCode } = require("../../utils/sequence");
const {
  USER_ROLE,
  FRANCHISE_STATUS,
  FRANCHISE_STATUS_VALUES,
} = require("../../constants/roles");

/*
==========================================
Admin franchise endpoints.

  listFranchises      GET    /api/admin/franchises
  getFranchiseById    GET    /api/admin/franchises/:id
  approveFranchise    PATCH  /api/admin/franchises/:id/approve
  rejectFranchise     PATCH  /api/admin/franchises/:id/reject
  listFranchiseLoans  GET    /api/admin/franchises/:id/loans

Approving mints the FRN code AND sets the initial password (the franchise's
registered mobile number, hashed) so the partner can log in with
franchiseId + mobile number as the password.
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

Approving mints the FRN code and stores a bcrypt hash of the franchise's
registered mobile number; that mobile is the first password. This block is
therefore built from the two public fields the admin already sees — never from
the stored hash. Returns null while the application is Pending/Rejected.
*/
const buildCredentials = (franchise) => {
  if (!franchise) return null;

  const loginId = franchise.franchiseId || null;
  if (!loginId) return null;

  return {
    loginId,
    password: franchise.mobile || null,
    passwordIsMobile: true,
    note: "Share these with the franchise partner. The password is the registered mobile number.",
  };
};

/* The PAN password hash is server-side only — never echo it back in a response. */
const withoutPassword = (franchise) => {
  const safe = franchise.toObject();
  delete safe.password;
  return safe;
};

const listFranchises = async ({ status, search, page, limit } = {}) => {
  const filter = { role: USER_ROLE.FRANCHISE };

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

  const safeLimit = Math.min(Math.max(Number(limit) || 0, 0), 100) || 0;
  const pageNumber = Math.max(Number(page) || 1, 1);

  const query = User.find(filter).sort({ createdAt: -1 });
  if (safeLimit > 0) query.skip((pageNumber - 1) * safeLimit).limit(safeLimit);

  return query;
};

const getFranchiseById = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw notFound("Franchise not found");

  const franchise = await User.findOne({ _id: id, role: USER_ROLE.FRANCHISE });
  if (!franchise) throw notFound("Franchise not found");

  return franchise;
};

const approveFranchise = async (id) => {
  const franchise = await getFranchiseById(id);

  if (franchise.franchiseStatus === FRANCHISE_STATUS.APPROVED) {
    throw conflict("This franchise is already approved");
  }

  if (!franchise.panNumber) {
    throw badRequest("This application is incomplete — the franchise must submit its details first");
  }

  // Mint the public FRN code and set the initial password: the registered
  // mobile number, hashed. The partner logs in with FRN + phone number.
  franchise.franchiseId = await nextFranchiseCode();
  franchise.password = await bcrypt.hash(String(franchise.mobile), 10);
  franchise.franchiseStatus = FRANCHISE_STATUS.APPROVED;
  franchise.franchiseApprovedAt = new Date();
  franchise.franchiseRejectedAt = null;

  await franchise.save();

  return withoutPassword(franchise);
};

const rejectFranchise = async (id, note) => {
  const franchise = await getFranchiseById(id);

  if (franchise.franchiseStatus === FRANCHISE_STATUS.REJECTED) {
    throw conflict("This franchise is already rejected");
  }

  franchise.franchiseStatus = FRANCHISE_STATUS.REJECTED;
  franchise.franchiseRejectedAt = new Date();
  if (note !== undefined && note !== null) {
    franchise.businessDetails = {
      ...(franchise.businessDetails || {}),
      adminNote: String(note).trim(),
    };
  }

  await franchise.save();

  return withoutPassword(franchise);
};

/*
Re-issue the login password for an already-approved franchise.

Franchises approved before the mobile-password rule have the PAN hashed as
their password, so their phone number does not work. This rebuilds the hash
from the registered mobile while keeping the FRN code and approval intact.
*/
const resetFranchisePassword = async (id) => {
  const franchise = await getFranchiseById(id);

  if (franchise.franchiseStatus !== FRANCHISE_STATUS.APPROVED) {
    throw badRequest("Only an approved franchise has login credentials to reset");
  }

  franchise.password = await bcrypt.hash(String(franchise.mobile), 10);
  await franchise.save();

  return withoutPassword(franchise);
};

/** How many applications were filed through this franchise, across all products. */
const countFranchiseLoans = async (franchiseObjectId) => {
  const counts = await Promise.all(
    Object.values(MODELS).map((Model) => Model.countDocuments({ franchise: franchiseObjectId }))
  );

  return counts.reduce((sum, count) => sum + count, 0);
};

/** All applications filed through this franchise, grouped per product. */
const listFranchiseLoans = async (id) => {
  const franchise = await getFranchiseById(id);

  const groups = await Promise.all(
    Object.entries(MODELS).map(async ([productKey, Model]) => {
      const applications = await Model.find({ franchise: franchise._id }).sort({ createdAt: -1 });
      if (!applications.length) return null;
      return {
        product: productKey,
        count: applications.length,
        applications,
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

module.exports = {
  listFranchises,
  getFranchiseById,
  approveFranchise,
  rejectFranchise,
  resetFranchisePassword,
  countFranchiseLoans,
  listFranchiseLoans,
  buildCredentials,
};
