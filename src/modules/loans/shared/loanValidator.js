const { body } = require("express-validator");

const { LOAN_PRODUCTS } = require("./loanProducts");
const handleValidationErrors = require("../../../middleware/validation.middleware");
const requireEntryProduct = require("../../../middleware/entryProduct.middleware");

const { SALARIED, BUSINESS, PROFESSIONAL } = require("./helpers");
const { loanBasicsRules } = require("./loanBasics.rules");
const { employmentTypeRules } = require("./employmentType.rules");
const { existingLoanExposureRules } = require("./existingLoanExposure.rules");
const { personalDetailsRules } = require("./personalDetails.rules");
const { salariedIncomeRules } = require("./incomeSalaried.rules");
const { selfEmployedIncomeRules } = require("./incomeSelfEmployed.rules");
const { homeLoanRequirementRules } = require("../home-loan/homeLoan.requirements.rules");
const { commercialPurchaseRequirementRules } = require("../commercial-purchase/commercialPurchase.requirements.rules");
const { leaseRentalDiscountingRequirementRules } = require("../lease-rental-discounting/leaseRentalDiscounting.requirements.rules");
const { loanAgainstShareRequirementRules } = require("../loan-against-share/loanAgainstShare.requirements.rules");
const { filmFundingRequirementRules } = require("../film-funding/filmFunding.requirements.rules");
const { fdiLoanRequirementRules } = require("../fdi-loan/fdiLoan.requirements.rules");
const { npaLoanRequirementRules } = require("../npa-loan/npaLoan.requirements.rules");
const { goldLoanRequirementRules } = require("../gold-loan/goldLoan.requirements.rules");
const { lapRequirementRules } = require("../loan-against-property/loanAgainstProperty.requirements.rules");
const { balanceTransferRequirementRules } = require("../balance-transfer/balanceTransfer.requirements.rules");
const { projectLoanRequirementRules } = require("../project-loan/projectLoan.requirements.rules");
const { vehicleLoanRequirementRules } = require("../vehicle-loan/vehicleLoan.requirements.rules");
const { educationLoanRequirementRules } = require("../education-loan/educationLoan.requirements.rules");
const { creditCardRequirementRules } = require("../credit-card/creditCard.requirements.rules");

/* =========================================================================
 * LOAN VALIDATORS — READ THIS FIRST
 * =========================================================================
 *
 * Almost every loan application is checked in the same order, in these steps:
 *
 *   0. middleware/entryProduct.middleware.js -> kya ye product isi token ka hai?
 *   1. loanBasics.rules.js             -> loanAmount + loanTenure
 *   2. <product>.requirements.rules.js -> the extra fields of ONE product
 *   3. existingLoanExposure.rules.js   -> old EMI + old loan amounts
 *   4. employmentType.rules.js         -> is this employment type allowed here?
 *   5. incomeSalaried.rules.js / incomeSelfEmployed.rules.js -> income fields
 *   6. personalDetails.rules.js        -> name, mobile, email, PAN, address
 *
 * Every file above exports ONE function that returns a "rules array".
 * A rules array is just a simple list of express-validator checks, like:
 *
 *   [ body("fullName").notEmpty().withMessage("Full name is required") ]
 *
 * buildApplyValidator("home") joins the lists for one product into the single
 * middleware list a route uses:
 *
 *   router.post("/apply", auth, normalizeApplyPayload, applyValidator, controller.apply);
 *
 * If any check fails, handleValidationErrors replies 400 with the first message.
 *
 * Which steps a product uses comes from LOAN_PRODUCTS in ./loanProducts.js.
 * To change a rule, open only the one file for that step.
 * ========================================================================= */

/** Income rules depend on `income` in LOAN_PRODUCTS: "salaried" | "selfEmployed" | "employment". */
const incomeRules = (config) => {
  if (config.income === "salaried") return salariedIncomeRules(config);
  if (config.income === "selfEmployed") return selfEmployedIncomeRules(config);
  return [...salariedIncomeRules(config), ...selfEmployedIncomeRules(config)];
};

/** Loan Requirements — the one section that differs for each product. */
const requirementRules = {
  buyingProperty: homeLoanRequirementRules,
  commercialPurchase: commercialPurchaseRequirementRules,
  leaseRentalDiscounting: leaseRentalDiscountingRequirementRules,
  loanAgainstShare: loanAgainstShareRequirementRules,
  filmFunding: filmFundingRequirementRules,
  fdiLoan: fdiLoanRequirementRules,
  npaLoan: npaLoanRequirementRules,
  goldLoan: goldLoanRequirementRules,
  collateralProperty: lapRequirementRules,
  balanceTransfer: balanceTransferRequirementRules,
  projectLoan: projectLoanRequirementRules,
  vehicleLoan: vehicleLoanRequirementRules,
  educationLoan: educationLoanRequirementRules,
  creditCard: creditCardRequirementRules,
};

/** Builds the full list of checks for one product. Used by every <product>.validator.js. */
const buildApplyValidator = (productKey) => {
  const config = LOAN_PRODUCTS[productKey];
  const requirements = config.loanRequirements ? requirementRules[config.loanRequirements]() : [];

  return [
    /*
    0. Product scope — customer ne jis product ki entry (OTP) ki thi, apply bhi
       wahi ho. Personal ka token home loan apply na kar sake -> 403
       (middleware/entryProduct.middleware.js).
    */
    requireEntryProduct(productKey),
    // 1. Loan Basics
    ...loanBasicsRules(config),
    // 2. Loan Requirements (empty for personal & business loans)
    ...requirements,
    // 3. Existing Loan Exposure
    ...existingLoanExposureRules(config),
    // 4. Employment Type
    ...employmentTypeRules(config),
    // 5. Income Details
    ...incomeRules(config),
    // 6. Personal Details
    ...personalDetailsRules(config),
    // The applicant must never send server-owned fields.
    body("status").not().exists().withMessage("status cannot be set by the applicant"),
    handleValidationErrors,
  ];
};

module.exports = { buildApplyValidator, SALARIED, BUSINESS, PROFESSIONAL };
