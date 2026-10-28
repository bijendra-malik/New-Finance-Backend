const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const { nextLoanApplicationNo } = require("../../utils/sequence");
const User = require("../auth/user.model");
const CustomerLoanDraft = require("./customerLoanDraft.model");
const CreditScoreRejection = require("./creditScoreRejection.model");
const { ACCOUNT_NOT_FOUND_MESSAGE } = require("../auth/entryDetails");
const { creditSnapshot } = require("./credit.service");
const { loanEligibilityRejectionReason } = require("../loans/shared/loanEligibility");
const { MODELS, describeLoanStatus, STATUS_STEP_LABELS } = require("../loans/shared/loanStatus");
const { LOAN_PRODUCTS } = require("../loans/shared/loanProducts");
const { createLoanApplicationWithLimit } = require("../loans/shared/loanApplicationLimit");
const {
  buildLoanDocument,
  sanitizeLoanResponse,
  compactLoanResponse,
  assertNoRecentApplication,
} = require("../loans/shared/loan.service");

const LOAN_DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;

/*
==========================================
Customer side service.

  getLoanApplyScreen     GET   /api/customer/loan-apply    (form ka config + bhari hui application)
  createCustomerLoanDraft POST /api/customer/loan-apply       (temporary form draft)
  finalizeCustomerLoanDraft POST /api/customer/credit-score   (eligible score submits draft)
  listCustomerLoans      GET   /api/customer/loans         (grouped, optional ?status=)
  getCustomerLoanDetail  GET   /api/customer/loans/:applicationNo
  getCustomerLoansByPan  GET   /api/customer/loan-status?panNumber=
  getCustomerSummary     GET   /api/customer/summary

Every read is scoped to `user = req.user.id`, so a customer can only ever see
their own applications.
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

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Some clients wrap the payload in a `data` object (same rule as the loan service). */
const unwrap = (body) =>
  body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body || {};

const cleanText = (value) => String(value ?? "").trim();

const resolveProduct = (payload) => {
  const product = cleanText(payload.product);
  if (!LOAN_PRODUCTS[product] || !MODELS[product]) {
    throw badRequest("A valid loan product is required");
  }
  return product;
};

/** Mongoose document -> plain object (so meta fields survive reads). */
const plain = (doc) => (typeof doc.toObject === "function" ? doc.toObject() : { ...doc });

/* --------------------------------------------------------------- apply -- */

/** Age in whole years from a birth date. */
const ageInYears = (birthDate) => {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  return age;
};

/*
Loan form ka SCREEN — ek hi call me jo bhi form ko chahiye.

  GET /api/customer/loan-apply?product=personal&employmentType=Salaried

  alreadyApplied / canApply pehle se apply kiya hua hai ya nahi
  data                      existing application (na ho to null); empty fields
                            aur duplicate section snapshot hata diye jaate hain
*/
const getLoanApplyScreen = async (
  customerId,
  { product: rawProduct } = {}
) => {
  const product = resolveProduct({ product: rawProduct });
  const data = compactLoanResponse(await getCustomerProductApplication(customerId, product));
  const pendingDraft = await getActiveCustomerLoanDraft(customerId, null, product);

  return {
    product,
    alreadyApplied: Boolean(data),
    canApply: !data,
    data,
    pendingDraft: pendingDraft
      ? {
          draftId: pendingDraft.draftId,
          expiresAt: pendingDraft.expiresAt,
          data: pendingDraft.payload,
        }
      : null,
  };
};

/**
 * Store the submitted form temporarily. The loan application is created only
 * after a qualifying credit score is submitted.
 */
const createCustomerLoanDraft = async (customerId, body = {}, account = null) => {
  const payload = unwrap(body);
  const product = resolveProduct(payload);
  const customer = account || (await User.findById(customerId));
  if (!customer) throw notFound(ACCOUNT_NOT_FOUND_MESSAGE);
  await assertNoRecentApplication(MODELS[product], customerId);
  // Each customer can have only one active form draft; a new submission replaces it.
  const draft = await CustomerLoanDraft.findOneAndUpdate(
    { user: customerId },
    {
      $set: {
        draftId: randomUUID(),
        product,
        payload,
        expiresAt: new Date(Date.now() + LOAN_DRAFT_RETENTION_MS),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return {
    draftId: draft.draftId,
    expiresAt: draft.expiresAt,
    product,
  };
};

const getActiveCustomerLoanDraft = async (customerId, draftId = null, product = null) => {
  const filter = {
    user: customerId,
    expiresAt: { $gt: new Date() },
  };
  if (draftId) filter.draftId = draftId;
  if (product) filter.product = product;

  return CustomerLoanDraft.findOne(filter);
};

const getCustomerLoanDraft = async (customerId) => {
  const draft = await getActiveCustomerLoanDraft(customerId);
  if (!draft) {
    return { hasPendingDraft: false, nextStep: "loan-apply", draft: null };
  }

  return {
    hasPendingDraft: true,
    nextStep: "credit-score",
    draft: {
      draftId: draft.draftId,
      product: draft.product,
      data: draft.payload,
      createdAt: draft.createdAt,
      expiresAt: draft.expiresAt,
      updatedAt: draft.updatedAt,
    },
  };
};

const requireActiveCustomerLoanDraft = async (customerId, draftId) => {
  const draft = await getActiveCustomerLoanDraft(customerId, draftId);
  if (!draft) {
    const error = new Error("Loan form draft was not found or has expired. Please submit the loan form again.");
    error.statusCode = 409;
    throw error;
  }
  return draft;
};

const cancelCustomerLoanDraft = async (customerId, draftId) => {
  const result = await CustomerLoanDraft.deleteOne({
    user: customerId,
    draftId,
    expiresAt: { $gt: new Date() },
  });
  if (result.deletedCount === 0) {
    const error = new Error("Loan form draft was not found. It may already be completed, cancelled, or expired.");
    error.statusCode = 404;
    throw error;
  }

  return { draftId, cancelled: true };
};

const finalizeCustomerLoanDraft = async (customerId, draftId, customer, options = {}) => {
  const draft = await requireActiveCustomerLoanDraft(customerId, draftId);
  const product = resolveProduct({ product: draft.product });

  // Final submit gate: company-type policy + credit score (600+ + window).
  /*
  Final-submit gate — reason milne par application "Rejected" status me save
  hoti hai (adminNote = reason, autoRejectedAt = TTL marker), throw nahi hoti.
  `options.forcedReason` credit-score door score < 600 par pass karta hai.
  */
  const reason =
    options.forcedReason || loanEligibilityRejectionReason(product, draft.payload, customer);
  await assertNoRecentApplication(MODELS[product], customerId);

  const applicationNo = await nextLoanApplicationNo();
  const document = buildLoanDocument(product, draft.payload, customerId, {
    applicationNo,
    credit: creditSnapshot(customer),
    ...(reason ? { rejection: reason } : {}),
  });
  const application = await createLoanApplicationWithLimit(customerId, () =>
    MODELS[product].create(document)
  );
  await CustomerLoanDraft.deleteOne({ _id: draft._id, user: customerId, draftId });

  return {
    rejected: Boolean(reason),
    reason,
    application: compactLoanResponse(sanitizeLoanResponse(product, application), { keepSections: true }),
    product,
  };
};

/**
 * Credit score < 600 par jab koi active loan-form draft nahi hota (customer ne
 * form bhara hi nahi, ya draft 24 ghante me expire ho gaya) — tab loan
 * application banti hi nahi, isliye admin ki Reject Loans list me kuch nahi
 * aata tha. Ye record usi gap ko bharta hai: kaun, kitna score, kya reason.
 *
 * Auto-rejected records are retained for 3 days, matching the same-product
 * application cooldown.
 */
const recordCreditScoreRejection = async (account, result) =>
  CreditScoreRejection.create({
    user: account._id,
    fullName: account.name || "",
    mobile: account.mobile || "",
    creditScore: result?.creditScore ?? null,
    reason: result?.message || "",
    autoRejectedAt: new Date(),
  });

/** Existing direct application for the selected product, if one exists. */
const getCustomerProductApplication = async (customerId, product) => {
  const key = resolveProduct({ product });
  const application = await MODELS[key].findOne({ user: customerId, franchise: null });
  return application ? sanitizeLoanResponse(key, application) : null;
};

/* ------------------------------------------------------- status helpers -- */

/**
 * Applicant-facing view of one application: raw status + friendly stage +
 * a small timeline so the dashboard can show exactly where it stands.
 */
const buildStatusView = (productKey, doc) => {
  const raw = plain(doc);
  const status = raw.status || "Submitted";
  const info = describeLoanStatus(status);

  const timeline = [{ step: "Application Submitted", at: raw.createdAt || null }];

  if (status === "Pending") {
    timeline.push({ step: "Under Review", at: raw.updatedAt || null });
  } else if (status === "Approved") {
    timeline.push({ step: "Approved", at: raw.approvedAt || raw.updatedAt || null });
  } else if (status === "Rejected") {
    timeline.push({ step: "Rejected", at: raw.rejectedAt || raw.updatedAt || null });
  }

  return {
    applicationNo: raw.applicationNo || null,
    product: productKey,
    loanType: raw.loanType || LOAN_PRODUCTS[productKey]?.loanType || null,
    loanAmount: raw.loanAmount ?? null,
    franchiseCode: raw.franchiseCode || null,
    status,
    stage: info.stage,
    stageKey: info.stageKey,
    step: info.step,
    stages: STATUS_STEP_LABELS,
    submittedAt: raw.createdAt || null,
    decisionAt: raw.approvedAt || raw.rejectedAt || null,
    adminNote: raw.adminNote || "",
    timeline,
    details: compactLoanResponse(sanitizeLoanResponse(productKey, raw)),
  };
};

/* ------------------------------------------------------------- reads -- */

/** One application by its human id (LOAN000001), owned by this customer. */
const getCustomerLoanDetail = async (customerId, applicationNo) => {
  const code = cleanText(applicationNo).toUpperCase();
  if (!code) throw badRequest("Application number is required");

  for (const [productKey, Model] of Object.entries(MODELS)) {
    const doc = await Model.findOne({ user: customerId, applicationNo: code });
    if (doc) return buildStatusView(productKey, doc);
  }

  throw notFound("Application not found");
};

/** All of this customer's applications, grouped per product (optional status filter). */
const listCustomerLoans = async (customerId, { status } = {}) => {
  const filter = { user: customerId };
  if (status) filter.status = status;

  const groups = await Promise.all(
    Object.entries(MODELS).map(async ([productKey, Model]) => {
      const applications = await Model.find(filter).sort({ createdAt: -1 });
      if (!applications.length) return null;
      return {
        product: productKey,
        count: applications.length,
        applications: applications.map((application) =>
          compactLoanResponse(sanitizeLoanResponse(productKey, application))
        ),
      };
    })
  );

  const data = groups.filter(Boolean);
  const total = data.reduce((sum, group) => sum + group.count, 0);

  return { total, data };
};

/**
 * Track applications by PAN — the applicant types their PAN and gets where each
 * of their loans stands. Scoped to the logged-in customer.
 */
const getCustomerLoansByPan = async (customerId, panNumber) => {
  const pan = cleanText(panNumber).toUpperCase();
  if (!pan) throw badRequest("PAN number is required");
  if (!PAN_REGEX.test(pan)) throw badRequest("Enter a valid PAN number (e.g. ABCDE1234F)");

  const applications = [];

  for (const [productKey, Model] of Object.entries(MODELS)) {
    const docs = await Model.find({ user: customerId, panNumber: pan }).sort({ createdAt: -1 });
    docs.forEach((doc) => applications.push(buildStatusView(productKey, doc)));
  }

  applications.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

  return { panNumber: pan, total: applications.length, applications };
};

/** Counts + recent activity for the customer dashboard header. */
const getCustomerSummary = async (customerId) => {
  const objectId = new mongoose.Types.ObjectId(customerId);

  const byStatus = { Submitted: 0, Pending: 0, Approved: 0, Rejected: 0 };
  const byProduct = [];
  let total = 0;
  const recent = [];

  for (const [productKey, Model] of Object.entries(MODELS)) {
    const rows = await Model.aggregate([
      { $match: { user: objectId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    let productTotal = 0;
    rows.forEach((row) => {
      const key = row._id || "Submitted";
      if (byStatus[key] !== undefined) byStatus[key] += row.count;
      else byStatus.Submitted += row.count;
      productTotal += row.count;
    });

    if (productTotal > 0) {
      byProduct.push({ product: productKey, count: productTotal });
      total += productTotal;
    }

    const latest = await Model.find({ user: customerId }).sort({ createdAt: -1 }).limit(3);
    latest.forEach((doc) => recent.push(buildStatusView(productKey, doc)));
  }

  recent.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

  return {
    total,
    byStatus,
    byProduct,
    recent: recent.slice(0, 5),
  };
};

module.exports = {
  getLoanApplyScreen,
  createCustomerLoanDraft,
  getActiveCustomerLoanDraft,
  getCustomerLoanDraft,
  requireActiveCustomerLoanDraft,
  cancelCustomerLoanDraft,
  finalizeCustomerLoanDraft,
  recordCreditScoreRejection,
  getCustomerProductApplication,
  listCustomerLoans,
  getCustomerLoanDetail,
  getCustomerLoansByPan,
  getCustomerSummary,
  buildStatusView,
  resolveProduct,
  ageInYears,
  PAN_REGEX,
};
