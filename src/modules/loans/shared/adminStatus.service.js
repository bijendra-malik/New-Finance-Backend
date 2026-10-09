/*
==========================================
Admin loan application endpoints.

ONE registry drives every product so the application resources never drift apart:

  RESOURCE_ROUTES  -> route -> { productKey, model, label, exportName }
  getListHandler   -> GET    /api/admin/{resource}
  getByIdHandler   -> GET    /api/admin/{resource}/:id
  updateStatusHandler -> PATCH /api/admin/{resource}/:id/status
  deleteApplicationHandler -> DELETE /api/admin/{resource}/:id

Status rules live in ./loanStatus.js — transitions are enforced and every
decision stamps approvedBy/approvedAt (or rejectedAt) + adminNote.
==========================================
*/

const { MODELS, SETTABLE_STATUSES, canTransition } = require("./loanStatus");

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
    exportName: "PersonalLoans",
  },
  "business-loans": {
    productKey: "business",
    label: "Business loan",
    exportName: "BusinessLoans",
  },
  "home-loans": {
    productKey: "home",
    label: "Home loan",
    exportName: "HomeLoans",
  },
  "loan-against-properties": {
    productKey: "lap",
    label: "Loan against property",
    exportName: "LoanAgainstProperties",
  },
  "balance-transfers": {
    productKey: "balanceTransfer",
    label: "Balance transfer",
    exportName: "BalanceTransfers",
  },
  "project-loans": {
    productKey: "projectLoan",
    label: "Project loan",
    exportName: "ProjectLoans",
  },
  "vehicle-loans": {
    productKey: "vehicleLoan",
    label: "Vehicle loan",
    exportName: "VehicleLoans",
  },
  "education-loans": {
    productKey: "educationLoan",
    label: "Education loan",
    exportName: "EducationLoans",
  },
  "credit-cards": {
    productKey: "creditCard",
    label: "Credit card",
    exportName: "CreditCards",
  },
  "working-capitals": {
    productKey: "workingCapital",
    label: "Working capital",
    exportName: "WorkingCapitals",
  },
  "commercial-purchases": {
    productKey: "commercialPurchase",
    label: "Commercial purchase",
    exportName: "CommercialPurchases",
  },
  "lease-rental-discountings": {
    productKey: "leaseRentalDiscounting",
    label: "Lease rental discounting",
    exportName: "LeaseRentalDiscountings",
  },
  "od-cc-limits": {
    productKey: "odCcLimit",
    label: "OD / CC limit",
    exportName: "OdCcLimits",
  },
  "loan-against-shares": {
    productKey: "loanAgainstShare",
    label: "Loan against share",
    exportName: "LoanAgainstShares",
  },
  "npa-loans": {
    productKey: "npaLoan",
    label: "NPA loan",
    exportName: "NpaLoans",
  },
  "gold-loans": {
    productKey: "goldLoan",
    label: "Gold loan",
    exportName: "GoldLoans",
  },
  "fdi-loans": {
    productKey: "fdiLoan",
    label: "FDI loan",
    exportName: "FdiLoans",
  },
  "film-fundings": {
    productKey: "filmFunding",
    label: "Film funding",
    exportName: "FilmFundings",
  },
};

const isValidObjectId = (value) =>
  typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

const modelFor = (resource) => {
  const entry = RESOURCE_ROUTES[resource];
  return entry ? MODELS[entry.productKey] : undefined;
};

const labelFor = (resource) => RESOURCE_ROUTES[resource]?.label;

/** GET /api/admin/{resource} — newest first. */
const getListHandler = (resource) => async (req, res, next) => {
  try {
    const Model = modelFor(resource);
    if (!Model) throw notFound("Unknown application type");

    const applications = await Model.find().sort({ createdAt: -1 });
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

    const application = await Model.findById(req.params.id);
    if (!application)
      throw notFound(`${labelFor(resource)} application not found`);

    res.status(200).json({ success: true, loan: application });
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

    const application = await Model.findById(req.params.id);
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

    const application = await Model.findById(req.params.id);
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
      loan: application,
    });
  } catch (error) {
    next(error);
  }
};

const User = require("../../auth/user.model");

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
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const groups = await Promise.all(
      Object.entries(MODELS).map(async ([productKey, Model]) => {
        const applications = await Model.find({ user: customerId }).sort({
          createdAt: -1,
        });
        if (!applications.length) return null;
        return {
          product: productKey,
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
  modelFor,
  labelFor,
  getListHandler,
  getByIdHandler,
  updateStatusHandler,
  deleteApplicationHandler,
  listCustomerApplications,
  isValidObjectId,
};
