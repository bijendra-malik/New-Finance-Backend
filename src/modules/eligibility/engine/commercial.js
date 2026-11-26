/* Commercial purchase — 1:1 port of eligibility/models/commercial.ts. */

const {
  COMMERCIAL_LTV,
  DSCR_MIN,
  FOIR_CAP,
  MIN_LOAN,
  creditRefusal,
  emiForPrincipal,
  holding,
  money,
  principalForEmi,
  roundTo,
  tenureText,
} = require("./core");

const commercialEligibility = (input) => {
  const { product } = input;

  const refusal = creditRefusal(input.creditScore, "Indicative commercial property loan");
  if (refusal) return refusal;

  const roi =
    input.roi !== undefined && Number.isFinite(input.roi) && input.roi >= 0 ? input.roi : product.roi;
  const months = Math.min(product.maxTenureMonths, Math.max(0, Math.round(input.months)));
  const propertyValue = Math.max(0, input.propertyValue);
  const rent = Math.max(0, input.monthlyRent);
  const coApplicant = Math.max(0, input.coApplicantIncome || 0);
  const income = Math.max(0, input.monthlyIncome) + coApplicant;
  const existing = Math.max(0, input.existingEmi);
  const ltv = Math.min(0.9, Math.max(0.3, (input.ltvPct !== undefined ? input.ltvPct : COMMERCIAL_LTV * 100) / 100));
  const foirCap = Math.min(0.9, Math.max(0.2, (input.foirPct !== undefined ? input.foirPct : FOIR_CAP * 100) / 100));
  const caps = [];

  if (propertyValue > 0) {
    caps.push({
      key: "asset",
      label: `Property value × ${Math.round(ltv * 100)}%`,
      value: roundTo(propertyValue * ltv, 1000),
    });
  }
  if (rent > 0 && months > 0) {
    caps.push({
      key: "dscr",
      label: `DSCR of ${DSCR_MIN}× on the rent`,
      value: roundTo(principalForEmi(rent / DSCR_MIN, roi, months), 1000),
    });
  }
  if (income > 0 && months > 0) {
    const headroom = Math.max(0, income * foirCap - existing);
    if (headroom > 0) {
      caps.push({
        key: "foir",
        label: `Repayment capacity at ${Math.round(foirCap * 100)}% FOIR`,
        value: roundTo(principalForEmi(headroom, roi, months), 1000),
      });
    }
  }

  if (caps.length === 0) {
    return holding(
      "Indicative commercial property loan",
      "Add the property's market value, and ideally the rent it earns, to see what it can support.",
      ["Rent is tested against a debt-service cover ratio before a commercial property is financed."],
      "PROPERTY_DETAILS_MISSING",
    );
  }

  const loan = Math.min(...caps.map((cap) => cap.value));
  const binding = caps.reduce((lowest, cap) => (cap.value < lowest.value ? cap : lowest)).label;
  const emi = emiForPrincipal(loan, roi, months);

  if (loan < MIN_LOAN) {
    return Object.assign(
      holding(
        "Indicative commercial property loan",
        `These figures support less than ${money(MIN_LOAN)}, below the smallest loan lenders sanction on commercial property.`,
        ["A more valuable property or stronger rent supports a larger loan."],
        "BELOW_MIN_LOAN",
      ),
      { caps, binding, roi, months },
    );
  }

  return {
    eligible: true,
    headline: loan,
    headlineLabel: "Indicative commercial property loan",
    monthly: Math.round(emi),
    monthlyLabel: "Monthly EMI",
    roi,
    months,
    caps,
    binding,
    foir:
      income > 0
        ? { used: (existing + emi) / income, headroom: Math.max(0, income * foirCap - existing - emi), income, existing }
        : null,
    message:
      rent > 0
        ? `A ${money(propertyValue)} commercial property at ${Math.round(ltv * 100)}% LTV and ${money(rent)} of monthly rent supports about ${money(loan)} at ${roi}% p.a. over ${tenureText(months)}.`
        : `A ${money(propertyValue)} commercial property at ${Math.round(ltv * 100)}% LTV supports about ${money(loan)} over ${tenureText(months)}. Add the rent to test the DSCR.`,
    suggestions: [],
    reasonCode: null,
  };
};

module.exports = { commercialEligibility };
