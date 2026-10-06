const mongoose = require("mongoose");
const { LOAN_PRODUCTS } = require("./loanProducts");

const {
  LOAN_FIELD_NAMES,
  SERVER_MANAGED_FIELD_NAMES,
  ADMIN_REVIEW_FIELDS,
  ADMIN_REVIEW_FIELD_NAMES,
  FRANCHISE_FIELDS,
} = require("./loanBasics.schema");
const {
  personalDetailsFields,
  requiredPersonalDetailsFields,
  PERSONAL_DETAILS_FIELD_NAMES,
} = require("./personalDetails.schema");
const {
  existingLoanExposureFields,
  EXPOSURE_FIELD_NAMES,
  MULTI_VALUE_EXPOSURE_FIELD_NAMES,
} = require("./existingLoanExposure.schema");
const { requiredSalariedIncomeFields, SALARIED_FIELD_NAMES } = require("./incomeSalaried.schema");
const {
  businessIncomeFields,
  SELF_EMPLOYED_FIELD_NAMES,
  PROFESSIONAL_FIELD_NAMES,
  BUSINESS_ADDRESS_FIELD_NAMES,
  TRANSACTION_BANK_FIELD_NAMES,
} = require("./incomeSelfEmployed.schema");
const { employmentIncomeFields } = require("./incomeEmployment.schema");
const { homeLoanRequirementFields } = require("../home-loan/homeLoan.requirements.schema");
const { commercialPurchaseRequirementFields } = require("../commercial-purchase/commercialPurchase.requirements.schema");
const { leaseRentalDiscountingRequirementFields } = require("../lease-rental-discounting/leaseRentalDiscounting.requirements.schema");
const { filmFundingRequirementFields } = require("../film-funding/filmFunding.requirements.schema");
const { fdiLoanRequirementFields } = require("../fdi-loan/fdiLoan.requirements.schema");
const { npaLoanRequirementFields } = require("../npa-loan/npaLoan.requirements.schema");
const { goldLoanRequirementFields } = require("../gold-loan/goldLoan.requirements.schema");
const { loanAgainstShareRequirementFields } = require("../loan-against-share/loanAgainstShare.requirements.schema");
const { lapRequirementFields } = require("../loan-against-property/loanAgainstProperty.requirements.schema");

const { balanceTransferRequirementFields } = require("../balance-transfer/balanceTransfer.requirements.schema");
const { projectLoanRequirementFields } = require("../project-loan/projectLoan.requirements.schema");
const { vehicleLoanRequirementFields } = require("../vehicle-loan/vehicleLoan.requirements.schema");
const { educationLoanRequirementFields } = require("../education-loan/educationLoan.requirements.schema");
const { creditCardRequirementFields } = require("../credit-card/creditCard.requirements.schema");

/* =========================================================================
 * LOAN SCHEMA REGISTRY — READ THIS FIRST
 * =========================================================================
 *
 * This file says WHICH FIELDS each loan stores in MongoDB.
 * (The sibling loanValidator.js says which of those fields are valid —
 *  same names, same order, same three shared sections. Keep the two in sync.)
 *
 * buildLoanSchema("home") joins these pieces, in this order:
 *
 *   1. loanBasics.schema.js            -> loanAmount + loanTenure (+ server fields)
 *   2. <product>.requirements.schema.js -> the extra fields of ONE product
 *   3. incomeSalaried.schema.js /
 *      incomeSelfEmployed.schema.js /
 *      incomeEmployment.schema.js      -> income fields (picked by config.income)
 *   4. existingLoanExposure.schema.js  -> old EMI + old loan amounts
 *   5. personalDetails.schema.js       -> name, mobile, email, PAN, address
 *
 * WHERE IS "LOAN REQUIREMENTS" DEFINED? (the part that differs per product)
 * Every product folder is self-contained — see modules/loans/<product>/:
 *
 *   ../home-loan/homeLoan.requirements.schema.js                       -> Home Loan
 *   ../commercial-purchase/commercialPurchase.requirements.schema.js   -> Commercial Purchase
 *   ../lease-rental-discounting/leaseRentalDiscounting.requirements.schema.js -> Lease Rental Discounting
 *   ../loan-against-share/loanAgainstShare.requirements.schema.js       -> Loan Against Share
 *   ../film-funding/filmFunding.requirements.schema.js                  -> Film Funding
 *   ../fdi-loan/fdiLoan.requirements.schema.js                          -> FDI Loan
 *   ../npa-loan/npaLoan.requirements.schema.js                          -> NPA Loan
 *   ../gold-loan/goldLoan.requirements.schema.js                        -> Gold Loan
 *   ../loan-against-property/loanAgainstProperty.requirements.schema.js -> Loan Against Property
 *   ../balance-transfer/balanceTransfer.requirements.schema.js         -> Balance Transfer
 *   ../project-loan/projectLoan.requirements.schema.js                 -> Project Loan
 *   ../vehicle-loan/vehicleLoan.requirements.schema.js                 -> Vehicle Loan
 *   ../education-loan/educationLoan.requirements.schema.js             -> Education Loan
 *   ../credit-card/creditCard.requirements.schema.js                   -> Credit Card
 *
 * These are the ONLY per-product schema files. Personal Loan and Business Loan
 * have none, because they only use the shared sections above.
 *
 * HOW TO ADD A NEW LOAN PRODUCT (3 steps):
 *   1. Create modules/loans/<new-loan>/<newLoan>.requirements.schema.js
 *      (only when the product has extra fields).
 *   2. Register it in the two maps below (loanRequirementSections /
 *      loanRequirementFieldNames) AND in loanValidator.js (requirementRules).
 *   3. Add one entry to loanProducts.js with the matching `loanRequirements` key.
 * ========================================================================= */

/** Key = LOAN_PRODUCTS[].income value. */
const incomeSections = {
  salaried: requiredSalariedIncomeFields,
  selfEmployed: businessIncomeFields,
  employment: employmentIncomeFields,
};

/** Key = LOAN_PRODUCTS[].loanRequirements value. */
const loanRequirementSections = {
  buyingProperty: homeLoanRequirementFields,
  commercialPurchase: commercialPurchaseRequirementFields,
  leaseRentalDiscounting: leaseRentalDiscountingRequirementFields,
  loanAgainstShare: loanAgainstShareRequirementFields,
  filmFunding: filmFundingRequirementFields,
  fdiLoan: fdiLoanRequirementFields,
  npaLoan: npaLoanRequirementFields,
  goldLoan: goldLoanRequirementFields,
  collateralProperty: lapRequirementFields,
  balanceTransfer: balanceTransferRequirementFields,
  projectLoan: projectLoanRequirementFields,
  vehicleLoan: vehicleLoanRequirementFields,
  educationLoan: educationLoanRequirementFields,
  creditCard: creditCardRequirementFields,
};

/** Field names per requirement, used by the service to trim responses. */
const loanRequirementFieldNames = {
  buyingProperty: Object.keys(homeLoanRequirementFields),
  commercialPurchase: Object.keys(commercialPurchaseRequirementFields),
  leaseRentalDiscounting: Object.keys(leaseRentalDiscountingRequirementFields),
  loanAgainstShare: Object.keys(loanAgainstShareRequirementFields),
  filmFunding: Object.keys(filmFundingRequirementFields),
  fdiLoan: Object.keys(fdiLoanRequirementFields),
  npaLoan: Object.keys(npaLoanRequirementFields),
  goldLoan: Object.keys(goldLoanRequirementFields),
  collateralProperty: Object.keys(lapRequirementFields),
  balanceTransfer: Object.keys(balanceTransferRequirementFields),
  projectLoan: Object.keys(projectLoanRequirementFields),
  vehicleLoan: Object.keys(vehicleLoanRequirementFields),
  educationLoan: Object.keys(educationLoanRequirementFields),
  creditCard: Object.keys(creditCardRequirementFields),
};

/** Which income fields actually apply to the submitted employment type. */
const incomeFieldNamesForEmploymentType = (employmentType) => {
  switch (String(employmentType || "").trim()) {
    case "Salaried":
      return [...SALARIED_FIELD_NAMES];
    case "Self Employed - Business":
      // The shared self-employed set also carries the professional-only fields.
      return SELF_EMPLOYED_FIELD_NAMES.filter((field) => !PROFESSIONAL_FIELD_NAMES.includes(field));
    case "Self Employed - Professional":
      return [
        ...PROFESSIONAL_FIELD_NAMES,
        ...BUSINESS_ADDRESS_FIELD_NAMES,
        ...TRANSACTION_BANK_FIELD_NAMES,
      ];
    default:
      return [];
  }
};

/** Builds a loan schema straight from its LOAN_PRODUCTS entry. */
const buildLoanSchema = (productKey) => {
  const config = LOAN_PRODUCTS[productKey];

  const requirementFields = config.loanRequirements ? loanRequirementSections[config.loanRequirements] : {};

  const personalDetails = config.personalDetailsRequired
    ? requiredPersonalDetailsFields
    : personalDetailsFields;

  return new mongoose.Schema(
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

      loanType: { type: String, enum: config.loanTypeEnum, default: config.loanType },

      // Credit Card has no amount/tenure — the config flags make them optional.
      ...(config.loanAmountRequired !== false
        ? { loanAmount: { type: Number, required: [true, "Loan amount is required"] } }
        : { loanAmount: { type: Number } }),
      ...(config.loanTenureRequired !== false
        ? { loanTenure: { type: Number, required: [true, "Loan tenure is required"] } }
        : { loanTenure: { type: Number } }),

      employmentType: {
        type: String,
        enum: config.employmentTypes,
        required: config.employmentTypeRequired ? [true, "Employment type is required"] : false,
        default: config.employmentTypeDefault,
      },

      ...requirementFields,
      ...incomeSections[config.income],
      ...existingLoanExposureFields,
      ...personalDetails,

      // Channel linkage — null for a direct customer application, set when an
      // approved franchise submits on the customer's behalf.
      ...FRANCHISE_FIELDS,

      status: {
        type: String,
        enum: ["Pending", "Approved", "Rejected", "Submitted"],
        default: "Submitted",
      },

      // Admin review trail (PATCH /api/admin/{resource}/:id/status) — the
      // applicant-facing API never accepts these fields (SERVER_MANAGED keeps
      // them out of buildLoanDocument; ADMIN_REVIEW_FIELD_NAMES keeps them in
      // admin responses).
      ...ADMIN_REVIEW_FIELDS,
    },
    { timestamps: true }
  );
};

module.exports = {
  buildLoanSchema,

  // Field-name lists, used by the service to copy / trim fields safely.
  LOAN_FIELD_NAMES,
  SERVER_MANAGED_FIELD_NAMES,
  ADMIN_REVIEW_FIELDS,
  ADMIN_REVIEW_FIELD_NAMES,
  PERSONAL_DETAILS_FIELD_NAMES,
  EXPOSURE_FIELD_NAMES,
  MULTI_VALUE_EXPOSURE_FIELD_NAMES,
  loanRequirementFieldNames,
  incomeFieldNamesForEmploymentType,

  // Field objects, used by tests.
  employmentIncomeFields,
  businessIncomeFields,
};
