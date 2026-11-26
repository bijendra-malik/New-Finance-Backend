/* Loan against shares — 1:1 port of eligibility/models/shares.ts. */

const {
  FOIR_CAP,
  MIN_HEADROOM,
  creditRefusal,
  emiForPrincipal,
  holding,
  money,
  principalForEmi,
  roundTo,
  tenureText,
} = require("./core");

const SHARE_LTV = 0.5;
const MIN_SHARE_LOAN = 25000;

const shareEligibility = (input) => {
  const { product, monthlyIncome: income, existingEmi: existing } = input;

  const refusal = creditRefusal(input.creditScore, "Indicative loan against shares");
  if (refusal) return refusal;

  const roi = input.roi && input.roi > 0 ? input.roi : product.roi;
  const months = Math.max(6, Math.min(product.maxTenureMonths, Math.round(input.months) || product.maxTenureMonths));
  const value = Math.max(0, input.marketValue);

  if (value <= 0) {
    return holding(
      "Indicative loan against shares",
      "Add the market value of the shares you will pledge to see the limit they support.",
      ["Only approved, fully paid-up listed shares are accepted as security."],
      "SHARE_VALUE_MISSING",
    );
  }

  const caps = [
    { key: "asset", label: `Share value × ${Math.round(SHARE_LTV * 100)}%`, value: roundTo(value * SHARE_LTV, 1000) },
  ];

  if (income > 0) {
    const headroom = Math.max(0, income * FOIR_CAP - existing);
    const capacity = roundTo(principalForEmi(headroom, roi, months), 1000);
    if (capacity > 0) caps.push({ key: "foir", label: "Repayment capacity", value: capacity });
  }

  const loan = Math.min(...caps.map((cap) => cap.value));
  const binding = caps.reduce((lowest, cap) => (cap.value < lowest.value ? cap : lowest)).label;
  const emi = emiForPrincipal(loan, roi, months);

  if (existing > 0 && income <= 0) {
    return holding(
      "Indicative loan against shares",
      "You have other EMIs on record but no income — add your monthly income so we can weigh them, or clear the EMI field.",
      ["Lenders check that the total EMI bill, including this loan, fits within your income."],
      "INCOME_MISSING",
    );
  }

  if (income > 0 && income * FOIR_CAP - existing < MIN_HEADROOM) {
    return holding(
      "Indicative loan against shares",
      existing > 0
        ? `Other EMIs of ${money(existing)} already use up the ${money(income * FOIR_CAP)} of income a lender will count, so this loan cannot be serviced.`
        : "This income does not leave enough room for a new EMI.",
      [
        "Closing or part-pre-paying an existing loan frees up room for a share-backed loan.",
        "Leave the income and EMI fields blank to value the loan on the shares alone.",
      ],
      "NO_EMI_HEADROOM",
    );
  }

  if (loan < MIN_SHARE_LOAN) {
    return Object.assign(
      holding(
        "Indicative loan against shares",
        `A ${money(value)} holding at ${Math.round(SHARE_LTV * 100)}% LTV supports less than the ${money(MIN_SHARE_LOAN)} most lenders will sanction.`,
        ["Pledge a larger holding, or add a monthly income so repayment capacity sets the limit."],
        "BELOW_MIN_LOAN",
      ),
      { caps, binding, roi, months, share: { value, ltv: SHARE_LTV } },
    );
  }

  return {
    eligible: true,
    headline: loan,
    headlineLabel: "Indicative loan against shares",
    monthly: Math.round(emi),
    monthlyLabel: "Monthly EMI",
    roi,
    months,
    caps,
    binding,
    foir: income > 0
      ? { used: (existing + emi) / income, headroom: Math.max(0, income * FOIR_CAP - existing - emi), income, existing }
      : null,
    message: `Shares worth ${money(value)} at a ${Math.round(SHARE_LTV * 100)}% LTV support ${money(loan)}, repayable over ${tenureText(months)}.`,
    suggestions: [],
    reasonCode: null,
    share: { value, ltv: SHARE_LTV },
  };
};

module.exports = { MIN_SHARE_LOAN, shareEligibility };
