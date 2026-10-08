const { LOAN_PRODUCTS } = require("./loanProducts");
const { MODELS } = require("./loanModels");
const { USER_ROLE } = require("../../../constants/roles");
const { nextLoanApplicationNo } = require("../../../utils/sequence");
const {
  LOAN_FIELD_NAMES,
  EXPOSURE_FIELD_NAMES,
  MULTI_VALUE_EXPOSURE_FIELD_NAMES,
  PERSONAL_DETAILS_FIELD_NAMES,
  SERVER_MANAGED_FIELD_NAMES,
  loanRequirementFieldNames,
  incomeFieldNamesForEmploymentType,
} = require("./loanSchema");
const {
  toBankNames,
  displayNameForBanks,
  normalizeTransactionBanks,
} = require("../../../utils/transactionBanks");

/**
 * Shared loan application service.
 *
 * Every product runs the exact same flow — copy the fields that belong to the
 * product + employment type, normalise them, save, and trim the response — so
 * the four product controllers are now three lines each.
 *
 * MODELS (every loan collection) lives in ./loanModels.js — a leaf module —
 * so the admin endpoints can reuse the exact same registry without circular
 * imports.
 */

/** Fields a client may send for this product + employment type. */
const dataFieldNames = (config, employmentType) => [
  "employmentType",
  ...LOAN_FIELD_NAMES,
  ...(config.loanRequirements ? loanRequirementFieldNames[config.loanRequirements] : []),
  ...incomeFieldNamesForEmploymentType(employmentType),
  ...EXPOSURE_FIELD_NAMES,
  ...PERSONAL_DETAILS_FIELD_NAMES,
];

/** Fields a response may contain (client fields + the server-managed ones). */
const responseFieldNames = (config, employmentType) => [
  ...dataFieldNames(config, employmentType),
  ...SERVER_MANAGED_FIELD_NAMES,
];

/*
Which field belongs to which form section, in the SAME ORDER the dashboard
shows them:

  1. Loan Requirements      -> loanAmount + loanTenure + this product's fields
  2. Income Details         -> employmentType + the income fields for it
  3. Existing Loan Exposure -> old EMI / old loan amounts
  4. Personal Details       -> name, mobile, email, PAN, address
*/
const sectionFieldNames = (config, employmentType) => ({
  loanRequirements: [
    // Products without an amount/tenure (Credit Card, NPA Loan) set the
    // matching required flag to false — those fields then never appear here.
    ...(config.loanAmountRequired !== false ? ["loanAmount"] : []),
    ...(config.loanTenureRequired !== false ? ["loanTenure"] : []),
    ...(config.loanRequirements ? loanRequirementFieldNames[config.loanRequirements] : []),
  ],
  incomeDetails: ["employmentType", ...incomeFieldNamesForEmploymentType(employmentType)],
  existingLoanExposure: [...EXPOSURE_FIELD_NAMES],
  personalDetails: [...PERSONAL_DETAILS_FIELD_NAMES],
});

/*
Builds the section-wise view of a saved application.

Sections list ONLY the fields the applicant actually filled, in dashboard
order. A field that was never sent is omitted (not shown as `null`), and an
"Other" free-text partner is hidden until it has a value — so the response
stays clean and every key that IS present carries real data. All four
section keys always exist (an untouched section is just `{}`).
*/
/*
Server-managed helpers that are copied from the config but never belong to an
applicant-facing section, so they must not show up as "missing" there.

`transactionBankOther` is only a fallback input (a free-text partner for the
"Other" bank selector) — the stored value always lands inside the
`transactionBankName` object on save, so the Other field itself never appears
in a saved application and must not show up as a perpetually-null entry.
*/
const SECTION_EXCLUDED_FIELDS = new Set(["transactionBankDisplayName", "transactionBankOther"]);

const isEmptyValue = (value) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const buildSections = (data, config, employmentType) => {
  const sections = {};

  Object.entries(sectionFieldNames(config, employmentType)).forEach(([section, fields]) => {
    const values = {};

    fields
      .filter((field) => !SECTION_EXCLUDED_FIELDS.has(field))
      .forEach((field) => {
        const value = data[field];
        if (isEmptyValue(value)) return; // never sent / empty -> omit
        values[field] = value;
      });

    sections[section] = values;
  });

  return sections;
};

const employmentTypeFor = (config, source) =>
  String(source.employmentType ?? config.employmentTypeDefault ?? "").trim();

/** Some clients wrap the application in a `data` object. */
const unwrap = (body) =>
  body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body || {};

const supportsTransactionBanks = (employmentType) =>
  incomeFieldNamesForEmploymentType(employmentType).includes("transactionBankName");

/**
 * Multi-select fields accept a single value, a CSV, or an array.
 *
 * Two groups of fields are repeatable: the shared exposure lists (existing
 * banks / loan types) and any "Loan Requirements" field a product declares in
 * its config (`multiValueFields`, e.g. Film Funding's languages + star cast).
 */
const normalizeMultiValueFields = (data, config) => {
  const multiValueFields = [
    ...MULTI_VALUE_EXPOSURE_FIELD_NAMES,
    ...(config.multiValueFields || []),
  ];

  multiValueFields.forEach((field) => {
    const value = data[field];
    if (value === undefined) return;

    const values = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [value];

    // Trim every entry so "Hindi, English" is stored as clean values.
    data[field] = values.map((item) => String(item ?? "").trim()).filter(Boolean);
  });
};

/**
 * Request body -> document ready for Model.create().
 * Server-owned values always come from the auth token / product, never the body.
 */
const buildLoanDocument = (productKey, body, userId, options = {}) => {
  const config = LOAN_PRODUCTS[productKey];
  const source = unwrap(body);
  const employmentType = employmentTypeFor(config, source);

  const data = { user: userId, loanType: config.loanType };

  /*
  Channel + identity fields are SERVER-owned: a direct customer application
  has franchise = null, while a franchise-submitted one carries the franchise
  account id + its FRN code. `applicationNo` is minted by the caller.
  */
  if (options.franchise) data.franchise = options.franchise;
  if (options.franchiseCode) data.franchiseCode = options.franchiseCode;
  if (options.applicationNo) data.applicationNo = options.applicationNo;
  // Franchise ka apna customer (CIBIL gate) — direct application me nahi hota.
  if (options.franchiseCustomer) data.franchiseCustomer = options.franchiseCustomer;

  dataFieldNames(config, employmentType).forEach((field) => {
    if (source[field] !== undefined) data[field] = source[field];
  });

  // Trim every string so stored values are clean whatever the client sends.
  Object.keys(data).forEach((field) => {
    if (typeof data[field] === "string") data[field] = data[field].trim();
  });

  normalizeMultiValueFields(data, config);

  // The dashboard posts these dates as dd/mm/yyyy.
  ["businessEstablishedDate", "projectStartDate", "projectCompletionDate"].forEach((field) => {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(data[field] || ""))) {
      const [day, month, year] = data[field].split("/");
      data[field] = `${year}-${month}-${day}`;
    }
  });

  const hasBankSelection =
    supportsTransactionBanks(employmentType) &&
    (data.transactionBankName !== undefined || Boolean(data.transactionBankOther));

  if (hasBankSelection) {
    data.transactionBankName = normalizeTransactionBanks(data.transactionBankName, data.transactionBankOther);
  }
  delete data.transactionBankDisplayName;
  // `transactionBankOther` is request-only input: after it is merged into
  // `transactionBankName` above it has no meaning of its own, so it is never
  // stored on the document (kept in the schema only for database compatibility).
  delete data.transactionBankOther;

  return data;
};

/** Keeps only the fields that belong to the product's submitted employment type. */
const sanitizeLoanResponse = (productKey, record) => {
  if (!record || typeof record !== "object") return record;
  if (Array.isArray(record)) return record.map((item) => sanitizeLoanResponse(productKey, item));

  const config = LOAN_PRODUCTS[productKey];
  const data = typeof record.toObject === "function" ? record.toObject() : { ...record };
  const employmentType = employmentTypeFor(config, data);
  const allowed = new Set(responseFieldNames(config, employmentType));

  Object.keys(data).forEach((field) => {
    if (!allowed.has(field)) delete data[field];
  });

  if (config.normalizeBankOnResponse && data.transactionBankName !== undefined && data.transactionBankName !== null) {
    const banks = toBankNames(data.transactionBankName);
    const storedDisplayName = data.transactionBankDisplayName || data.transactionBankName.displayName;

    data.transactionBankName = {
      displayName:
        storedDisplayName && String(storedDisplayName).trim()
          ? String(storedDisplayName).trim()
          : displayNameForBanks(banks),
      banks,
    };
  }

  delete data.transactionBankDisplayName;

  // Section-wise view, in dashboard order (Loan Requirements -> Income ->
  // Exposure -> Personal). The flat fields above stay for existing clients.
  data.sections = buildSections(data, config, employmentType);

  return data;
};

/** POST /apply + GET /applications for one product. */
const createLoanController = (productKey) => {
  const Model = MODELS[productKey];

  return {
    apply: async (req, res, next) => {
      try {
        // Customer product routes are for customer tokens only; a franchise
        // must use POST /api/franchise/loan-apply so the channel is recorded.
        if (req.user && req.user.role === USER_ROLE.FRANCHISE) {
          return res.status(403).json({
            success: false,
            message: "Franchise accounts must apply through POST /api/franchise/loan-apply",
          });
        }

        const applicationNo = await nextLoanApplicationNo();
        const application = await Model.create(
          buildLoanDocument(productKey, req.body, req.user.id, { applicationNo })
        );
        res.status(201).json({ success: true, data: sanitizeLoanResponse(productKey, application) });
      } catch (error) {
        if (error.name === "ValidationError") {
          return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: Object.values(error.errors).map((item) => item.message),
          });
        }
        next(error);
      }
    },

    list: async (req, res, next) => {
      try {
        const applications = await Model.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json({
          success: true,
          data: applications.map((application) => sanitizeLoanResponse(productKey, application)),
        });
      } catch (error) {
        next(error);
      }
    },
  };
};

module.exports = {
  createLoanController,
  buildLoanDocument,
  sanitizeLoanResponse,
};
