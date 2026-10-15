const mongoose = require("mongoose");

const User = require("../auth/user.model");
const { nextLoanApplicationNo } = require("../../utils/sequence");
const { MODELS, describeLoanStatus, STATUS_STEP_LABELS } = require("../loans/shared/loanStatus");
const { LOAN_PRODUCTS } = require("../loans/shared/loanProducts");
const {
  buildLoanDocument,
  sanitizeLoanResponse,
  assertNoExistingDirectApplication,
  sectionFieldNames,
} = require("../loans/shared/loan.service");

/*
==========================================
Customer side service.

  getLoanApplyScreen     GET   /api/customer/loan-apply    (form ka config + bhari hui application)
  createCustomerLoan     POST  /api/customer/loan-apply       (direct application)
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

  product / loanType        kis loan ka form hai
  employmentTypes           dropdown ke options
  employmentType            chuna hua type (query -> bhari hui application -> default)
  fields                    US employment type ke hisaab se section-wise field names
  prefill                   entry par verify hui identity details (form inhi se bharta hai)
  alreadyApplied / canApply pehle se apply kiya hua hai ya nahi
  data                      bhari hui application (na ho to null)

Field names wahi hain jo product ka schema aur validator use karte hain
(sectionFieldNames se) — isliye form aur backend out of sync nahi jaate, aur jo
fields form ko chahiye wahi response me aate hain (koi limits/message ka static
stock nahi).
*/
const getLoanApplyScreen = async (
  customerId,
  { product: rawProduct, employmentType: rawEmploymentType } = {}
) => {
  const product = resolveProduct({ product: rawProduct });
  const config = LOAN_PRODUCTS[product];

  const data = await getCustomerProductApplication(customerId, product);

  const employmentTypes = config.employmentTypes || [];
  const employmentType =
    cleanText(rawEmploymentType) ||
    cleanText(data?.employmentType) ||
    cleanText(config.employmentTypeDefault) ||
    cleanText(employmentTypes[0]);

  return {
    product,
    loanType: data?.loanType || config.loanType,
    employmentTypes,
    employmentType,
    fields: sectionFieldNames(config, employmentType),
    prefill: completePrefill(await getEntryPrefill(customerId), data),
    alreadyApplied: Boolean(data),
    canApply: !data,
    applicationNo: data?.applicationNo || null,
    data,
  };
};

/**
 * Entry par verify hui identity details — form inhi se prefill hota hai.
 * (Loan apply karte waqt inhi details ka match hona bhi zaroori hai —
 *  middleware/entryDetails.middleware.js.)
 */
const getEntryPrefill = async (customerId) => {
  const account = await User.findById(customerId).select(
    "name mobile email dob panNumber continent country state city pincode"
  );

  if (!account) return null;

  return {
    fullName: account.name || "",
    mobile: account.mobile || "",
    email: account.email || "",
    dob: account.dob ? account.dob.toISOString().slice(0, 10) : "",
    panNumber: account.panNumber || "",
    continent: account.continent || "",
    country: account.country || "",
    state: account.state || "",
    city: account.city || "",
    pincode: account.pincode || "",
  };
};

/**
 * Entry form me state / city / pincode nahi puchhe jaate (sirf continent + country),
 * isliye account par ye khaali rehte hain — jabki loan form me ye fields hote hain
 * aur submitted application par bhari hui values maujood hoti hain.
 *
 * Isliye jab application ho, to prefill ko usi application se complete karo, taaki
 * response me `prefill` aur `data` aapas me match karein aur already-applied screen
 * par address khaali na dikhe. Account ki value pehle jeetegi — application se sirf
 * khaali field bharti hai.
 */
const COMPLETABLE_PREFILL_FIELDS = [
  "fullName",
  "mobile",
  "email",
  "dob",
  "panNumber",
  "state",
  "city",
  "pincode",
];

const asDateOnly = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const completePrefill = (prefill, application) => {
  if (!prefill || !application) return prefill;

  const merged = { ...prefill };

  COMPLETABLE_PREFILL_FIELDS.forEach((field) => {
    if (cleanText(merged[field])) return;

    const value = application[field];
    if (value === undefined || value === null || value === "") return;

    merged[field] = field === "dob" ? asDateOnly(value) : cleanText(value);
  });

  return merged;
};

/**
 * Create one direct application for the authenticated customer.
 * `franchise` stays null and a fresh `applicationNo` (LOAN000001) is stamped.
 */
const createCustomerLoan = async (customerId, body = {}) => {
  const payload = unwrap(body);
  const product = resolveProduct(payload);

  await assertNoExistingDirectApplication(MODELS[product], customerId);

  const applicationNo = await nextLoanApplicationNo();

  const document = buildLoanDocument(product, payload, customerId, { applicationNo });
  const application = await MODELS[product].create(document);

  return { application: sanitizeLoanResponse(product, application), product };
};

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
    details: sanitizeLoanResponse(productKey, raw),
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
        applications: applications.map((application) => sanitizeLoanResponse(productKey, application)),
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
  getEntryPrefill,
  createCustomerLoan,
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
