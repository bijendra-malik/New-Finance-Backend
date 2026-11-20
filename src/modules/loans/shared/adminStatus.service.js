/*
==========================================
Admin loan application endpoints.

ONE registry drives every product so the application resources never drift apart:

  RESOURCE_ROUTES  -> route -> { productKey, label }
  getListHandler   -> GET    /api/admin/{resource}
  getByIdHandler   -> GET    /api/admin/{resource}/:id
  updateStatusHandler -> PATCH /api/admin/{resource}/:id/status
  deleteApplicationHandler -> DELETE /api/admin/{resource}/:id

Status rules live in ./loanStatus.js — transitions are enforced and every
decision stamps approvedBy/approvedAt (or rejectedAt) + adminNote.
==========================================
*/

const { MODELS, SETTABLE_STATUSES, canTransition } = require("./loanStatus");
const {
  hasProductAccess,
  isSuperAdmin,
  visibleLoanFilter,
} = require("../../admin/adminLoanAccess");

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

const RESOURCE_ROUTES = {
  "personal-loans": {
    productKey: "personal",
    label: "Personal loan",
  },
  "business-loans": {
    productKey: "business",
    label: "Business loan",
  },
  "home-loans": {
    productKey: "home",
    label: "Home loan",
  },
  "loan-against-properties": {
    productKey: "lap",
    label: "Loan against property",
  },
  "balance-transfers": {
    productKey: "balanceTransfer",
    label: "Balance transfer",
  },
  "project-loans": {
    productKey: "projectLoan",
    label: "Project loan",
  },
  "vehicle-loans": {
    productKey: "vehicleLoan",
    label: "Vehicle loan",
  },
  "education-loans": {
    productKey: "educationLoan",
    label: "Education loan",
  },
  "credit-cards": {
    productKey: "creditCard",
    label: "Credit card",
  },
  "working-capitals": {
    productKey: "workingCapital",
    label: "Working capital",
  },
  "commercial-purchases": {
    productKey: "commercialPurchase",
    label: "Commercial purchase",
  },
  "lease-rental-discountings": {
    productKey: "leaseRentalDiscounting",
    label: "Lease rental discounting",
  },
  "od-cc-limits": {
    productKey: "odCcLimit",
    label: "OD / CC limit",
  },
  "loan-against-shares": {
    productKey: "loanAgainstShare",
    label: "Loan against share",
  },
  "npa-loans": {
    productKey: "npaLoan",
    label: "NPA loan",
  },
  "gold-loans": {
    productKey: "goldLoan",
    label: "Gold loan",
  },
  "fdi-loans": {
    productKey: "fdiLoan",
    label: "FDI loan",
  },
  "film-fundings": {
    productKey: "filmFunding",
    label: "Film funding",
  },
};

const isValidObjectId = (value) =>
  typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

const modelFor = (resource) => {
  const entry = RESOURCE_ROUTES[resource];
  return entry ? MODELS[entry.productKey] : undefined;
};

const labelFor = (resource) => RESOURCE_ROUTES[resource]?.label;

/*
Admin UI ke liye ek hi shape — direct customer aur franchise application ka farq
saaf rahe.

`franchise` / `franchiseCode` / `franchiseCustomer` teeno `null` padte hain jab
customer ne khud apply kiya ho (`visibleLoanFilter` direct applications ko
`franchise: null` se pehchanta hai). Admin panel un fields ko dekh kar franchise
ka card / section render kar deta hai, jo normal customer ke loan par nahi hona
chahiye. Isliye direct application par ye fields response se hata dete hain;
franchise se aayi application par waise hi rehte hain. `applicationSource` dono
case me channel saaf batata hai.
*/
const FRANCHISE_LINK_FIELDS = ["franchise", "franchiseCode", "franchiseCustomer"];

const toAdminLoanView = (doc) => {
  const loan = typeof doc?.toObject === "function" ? doc.toObject() : { ...doc };
  const fromFranchise = Boolean(loan.franchise);

  if (!fromFranchise) {
    FRANCHISE_LINK_FIELDS.forEach((field) => delete loan[field]);
  }

  loan.applicationSource = fromFranchise ? "franchise-customer" : "customer";
  return loan;
};

/** GET /api/admin/{resource} — newest first. */
const getListHandler = (resource) => async (req, res, next) => {
  try {
    const Model = modelFor(resource);
    if (!Model) throw notFound("Unknown application type");

    const applications = await Model.find(visibleLoanFilter(req.admin)).sort({ createdAt: -1 });
    res.status(200).json({ success: true, loans: applications });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/{resource}/:id */
const getByIdHandler = (resource) => async (req, res, next) => {
  try {
    const Model = modelFor(resource);
    if (!Model) throw notFound("Unknown application type");

    if (!isValidObjectId(req.params.id))
      throw notFound("Application not found");

    const application = await Model.findOne(
      visibleLoanFilter(req.admin, { _id: req.params.id })
    );
    if (!application)
      throw notFound(`${labelFor(resource)} application not found`);

    res.status(200).json({ success: true, loan: toAdminLoanView(application) });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/{resource}/:id — permanently removes one application.
 * Unknown resource/id -> 404. The customer's OTHER applications are untouched
 * (use the customer delete flow to wipe every application of one customer).
 */
const deleteApplicationHandler = (resource) => async (req, res, next) => {
  try {
    const Model = modelFor(resource);
    if (!Model) throw notFound("Unknown application type");

    if (!isValidObjectId(req.params.id))
      throw notFound("Application not found");

    const application = await Model.findOne(
      visibleLoanFilter(req.admin, { _id: req.params.id })
    );
    if (!application)
      throw notFound(`${labelFor(resource)} application not found`);

    await application.deleteOne();

    res.json({
      success: true,
      message: `${labelFor(resource)} application deleted`,
      deletedId: application._id,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/{resource}/:id/status
 * Body: { status: "Pending"|"Approved"|"Rejected", note? }
 *
 * - Unknown resource/id -> 404
 * - Unknown status -> 400
 * - Illegal transition (e.g. Approved -> anything, or no-op) -> 409
 * - Stamps approvedBy/approvedAt (or rejectedAt) + adminNote.
 *
 * Kaun chala sakta hai: normal admin (apne product par), sub admin
 * `loans.decide` permission ke saath, aur super admin. Guard
 * ../admin/application.routes.js me hai.
 */
const updateStatusHandler = (resource) => async (req, res, next) => {
  try {
    const Model = modelFor(resource);
    if (!Model) throw notFound("Unknown application type");

    const { status, note } = req.body ?? {};

    if (!status) throw badRequest("Status is required");
    if (!SETTABLE_STATUSES.includes(status)) {
      throw badRequest(
        `Status must be one of: ${SETTABLE_STATUSES.join(", ")}`,
      );
    }

    const noteText =
      note === undefined || note === null ? "" : String(note).trim();
    if (noteText.length > 500) {
      throw badRequest("Note is too long (max 500 characters)");
    }

    if (!isValidObjectId(req.params.id))
      throw notFound("Application not found");

    const application = await Model.findOne(
      visibleLoanFilter(req.admin, { _id: req.params.id })
    );
    if (!application)
      throw notFound(`${labelFor(resource)} application not found`);

    const currentStatus = application.status || "Submitted";

    if (currentStatus === status) {
      return res.status(409).json({
        success: false,
        message: `This application is already ${status}`,
      });
    }

    if (!canTransition(currentStatus, status)) {
      return res.status(409).json({
        success: false,
        message: `Application is already ${currentStatus} — its status can no longer be changed`,
      });
    }

    /*
    Every final decision is also written to the timeline so the super admin
    dashboard can show who moved this application and when without opening
    each application.
    */
    const actor = req.admin || {};
    const actorName =
      actor.name || actor.fullName || actor.loginId || actor.email || "Admin";
    if (!Array.isArray(application.adminUpdates)) application.adminUpdates = [];
    application.adminUpdates.unshift({
      text: `Status changed: ${currentStatus} → ${status}${noteText ? ` — ${noteText}` : ""}`,
      kind: "status",
      suggestedStatus: status,
      addedBy: actor.id || actor._id || null,
      addedByName: actorName,
      addedByRole: actor.role || "",
      addedAt: new Date(),
    });
    // The decision is final now, so a pending recommendation is stale.
    application.statusRecommendation = null;
    application.status = status;
    application.adminNote = noteText;

    if (status === "Approved") {
      application.approvedAt = new Date();
      application.approvedBy = req.admin?.id || null;
    }
    if (status === "Rejected") {
      application.rejectedAt = new Date();
      application.approvedBy = req.admin?.id || null;
    }

    await application.save();

    res.json({
      success: true,
      message: `${labelFor(resource)} application marked ${status.toLowerCase()}`,
      loan: toAdminLoanView(application),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/{resource}/:id/updates
 * Body: { text: string, suggestedStatus?: string }
 *
 * Sirf REGULAR admin (product access ke saath) application par update/remark
 * ya status recommendation de sakta hai. Super Admin ka kaam sunna aur final
 * decision lena hai — woh loan par message nahi karta, isliye yahan 403.
 * (Status PATCH /:id/status se badalta hai — normal admin, `loans.decide` wala
 * sub admin aur super admin, teeno ke liye — aur wo audit trail me
 * kind: "status" ke roop me record hota hai.)
 */
const addUpdateHandler = (resource) => async (req, res, next) => {
  try {
    const Model = modelFor(resource);
    if (!Model) throw notFound("Unknown application type");

    if (isSuperAdmin(req.admin)) {
      return res.status(403).json({
        success: false,
        message:
          "Super admins cannot add updates on loan applications — only regular admins can.",
      });
    }

    const { text, suggestedStatus } = req.body ?? {};
    const updateText = text === undefined || text === null ? "" : String(text).trim();

    const suggestion = suggestedStatus ? String(suggestedStatus).trim() : "";
    if (suggestion && !SETTABLE_STATUSES.includes(suggestion)) {
      throw badRequest(`Suggested status must be one of: ${SETTABLE_STATUSES.join(", ")}`);
    }
    if (!updateText && !suggestion) {
      throw badRequest("Update text or a suggested status is required");
    }
    if (updateText.length > 500) {
      throw badRequest("Update is too long (max 500 characters)");
    }

    if (!isValidObjectId(req.params.id))
      throw notFound("Application not found");

    const application = await Model.findOne(
      visibleLoanFilter(req.admin, { _id: req.params.id })
    );
    if (!application)
      throw notFound(`${labelFor(resource)} application not found`);

    const admin = req.admin || {};
    const addedByName =
      admin.name || admin.fullName || admin.loginId || admin.email || "Admin";
    const addedByRole = admin.role || "";

    if (suggestion) {
      application.statusRecommendation = {
        status: suggestion,
        note: updateText,
        recommendedBy: admin.id || admin._id || null,
        recommendedByName: addedByName,
        recommendedByRole: addedByRole,
        recommendedAt: new Date(),
      };
    }

    if (!Array.isArray(application.adminUpdates)) {
      application.adminUpdates = [];
    }

    application.adminUpdates.unshift({
      text: updateText || `Recommended ${suggestion}`,
      kind: suggestion ? "recommendation" : "note",
      suggestedStatus: suggestion || null,
      addedBy: admin.id || admin._id || null,
      addedByName,
      addedByRole,
      addedAt: new Date(),
    });

    await application.save();

    res.json({
      success: true,
      message: "Update added successfully",
      loan: toAdminLoanView(application),
    });
  } catch (error) {
    next(error);
  }
};

const User = require("../../auth/user.model");
const { USER_ROLE } = require("../../../constants/roles");

/**
 * GET /api/admin/customers/:id/applications
 * Every product's applications for one customer, grouped per product.
 */
const listCustomerApplications = async (req, res, next) => {
  try {
    const customerId = req.params.id;
    if (!isValidObjectId(customerId)) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const customer = await User.findById(customerId);
    if (!customer || customer.role === USER_ROLE.FRANCHISE) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const groups = await Promise.all(
      Object.entries(RESOURCE_ROUTES)
        .filter(([, entry]) => hasProductAccess(req.admin, entry.productKey))
        .map(async ([, entry]) => {
        const Model = MODELS[entry.productKey];
        const applications = await Model.find(
          visibleLoanFilter(req.admin, { user: customerId })
        ).sort({
          createdAt: -1,
        });
        if (!applications.length) return null;
        return {
          product: entry.productKey,
          count: applications.length,
          applications,
        };
      }),
    );

    const data = groups.filter(Boolean);
    const total = data.reduce((sum, group) => sum + group.count, 0);

    res.json({
      success: true,
      customer: {
        _id: customer._id,
        name: customer.name,
        email: customer.email,
        mobile: customer.mobile,
      },
      total,
      data,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  RESOURCE_ROUTES,
  getListHandler,
  getByIdHandler,
  updateStatusHandler,
  addUpdateHandler,
  deleteApplicationHandler,
  listCustomerApplications,
  isValidObjectId,
};
