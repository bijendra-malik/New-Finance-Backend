/*
==========================================
Eligibility rules — product rate card + family dispatch

Rate card wahi 13 products hain jo website ke eligibility/models/core.ts me
hain. Har product ka apna family engine hai (term, gold, education, project,
commercial, turnover, wc, lrd, share) — koi bhi number invent nahi hota.

Public flow:
  GET  /api/eligibility/rate-card  -> PRODUCTS
  POST /api/eligibility/check      -> calculateEligibility()
==========================================
*/

const { PRODUCTS, MIN_LOAN, MIN_GOLD_LOAN, CREDIT_SCORE_FLOOR } = require("./engine/core");
const { evaluate, formulaFor } = require("./engine");
const { MIN_SHARE_LOAN } = require("./engine/shares");
const { legacyCodeFor } = require("./eligibility.input");

const REASON_LABELS = {
  CREDIT_SCORE_MISSING: "Credit score required",
  CREDIT_SCORE_LOW: `Credit score below ${CREDIT_SCORE_FLOOR}`,
  INCOME_MISSING: "Income not enough or not declared",
  NO_EMI_HEADROOM: "Not enough EMI headroom",
  AGE_TENURE_OVER: "No repayment tenure left before maturity age",
  TENURE_TOO_SHORT: "Less than a year of tenure left",
  BELOW_MIN_LOAN: "Limit below this product's minimum loan",
  GOLD_DETAILS_MISSING: "Gold weight or rate missing",
  EDU_COST_MISSING: "Course cost missing",
  TENURE_NONE: "No repayment tenure left",
  CO_APPLICANT_CAPACITY_LOW: "Co-applicant income supports too little",
  PROJECT_COST_MISSING: "Project cost missing",
  CONTRIBUTION_COVERS_COST: "Promoter contribution covers the whole project",
  PROPERTY_DETAILS_MISSING: "Property value missing",
  TURNOVER_MISSING: "Projected turnover missing",
  BALANCE_SHEET_MISSING: "Current assets and liabilities missing",
  LEASE_DETAILS_MISSING: "Rent, lease or property value missing",
  SHARE_VALUE_MISSING: "Share value missing",
  NOT_ELIGIBLE: "Not eligible on the given figures",
};

const MIN_LOAN_BY_FAMILY = { gold: MIN_GOLD_LOAN, share: MIN_SHARE_LOAN };

/** Public rate card — frontend dropdown, ROI aur tenure table. */
const rateCard = () =>
  PRODUCTS.map((product) => ({
    key: product.key,
    code: legacyCodeFor(product.key),
    label: product.label,
    family: product.family,
    roi: product.roi,
    tenureMonths: product.maxTenureMonths,
    maxTenureMonths: product.maxTenureMonths,
    minLoan: MIN_LOAN_BY_FAMILY[product.family] || MIN_LOAN,
    minCreditScore: CREDIT_SCORE_FLOOR,
    secured: !product.unsecured,
    rateOnRequest: false,
    formula: formulaFor(product.family),
  }));

/**
 * Ek product + normalized form inputs -> outcome.
 * `reasonCode` batata hai kis rule par ruka (eligible par null).
 */
const calculateEligibility = ({ product, inputs }) => {
  const outcome = evaluate(product, inputs);
  const eligible = Boolean(outcome.eligible);
  const reasonCode = eligible ? null : outcome.reasonCode || "NOT_ELIGIBLE";

  return {
    outcome,
    eligible,
    decision: eligible ? "eligible" : "not_eligible",
    reasonCode,
    reasonLabel: reasonCode ? REASON_LABELS[reasonCode] || REASON_LABELS.NOT_ELIGIBLE : null,
  };
};

module.exports = { rateCard, calculateEligibility };
