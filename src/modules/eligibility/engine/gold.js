/* Gold loans — 1:1 port of eligibility/models/gold.ts. */

const {
  FOIR_CAP,
  MIN_GOLD_LOAN,
  MIN_HEADROOM,
  creditRefusal,
  emiForPrincipal,
  goldLtvFor,
  holding,
  money,
  principalForEmi,
  roundTo,
} = require("./core");

const goldEligibility = (input) => {
  const { product, grams, ratePerGram, monthlyIncome: income, existingEmi: existing } = input;

  const refusal = creditRefusal(input.creditScore, "Indicative gold loan");
  if (refusal) return refusal;

  const roi = input.roi && input.roi > 0 ? input.roi : product.roi;
  const months = Math.max(1, Math.min(12, Math.round(input.months) || 12));
  const netWeight = Math.max(0, grams);

  if (netWeight <= 0 || ratePerGram <= 0) {
    return holding(
      "Indicative gold loan",
      "Add the net weight of the jewellery and today's rate for its purity to value the pledge.",
      ["Net weight is gross weight minus stones, beads, thread and lac."],
      "GOLD_DETAILS_MISSING",
    );
  }

  const value = netWeight * ratePerGram;
  const ltv = goldLtvFor(value);
  const ltvCap = roundTo(value * ltv, 1000);

  const caps = [{ key: "gold", label: `Gold value × ${Math.round(ltv * 100)}%`, value: ltvCap }];

  if (income > 0) {
    const headroom = Math.max(0, income * FOIR_CAP - existing);
    const capacity = roundTo(principalForEmi(headroom, roi, months), 1000);
    if (capacity > 0) caps.push({ key: "foir", label: "Repayment capacity", value: capacity });
  }

  const loan = Math.min(...caps.map((cap) => cap.value));
  const binding = caps.reduce((lowest, cap) => (cap.value < lowest.value ? cap : lowest)).label;
  const emi = emiForPrincipal(loan, roi, months);
  const foir = income > 0
    ? { used: (existing + emi) / income, headroom: Math.max(0, income * FOIR_CAP - existing - emi), income, existing }
    : null;

  if (existing > 0 && income <= 0) {
    return holding(
      "Indicative gold loan",
      "You have other EMIs on record but no income — add your monthly income so we can weigh them, or clear the EMI field.",
      ["Lenders check that the total EMI bill, including this loan, fits within your income."],
      "INCOME_MISSING",
    );
  }

  if (income > 0 && income * FOIR_CAP - existing < MIN_HEADROOM) {
    return holding(
      "Indicative gold loan",
      existing > 0
        ? `Other EMIs of ${money(existing)} already use up the ${money(income * FOIR_CAP)} of income a lender will count, so this loan cannot be serviced.`
        : "This income does not leave enough room for a new EMI.",
      [
        "Closing or part-pre-paying an existing loan frees up room for a gold loan.",
        "Leave the income and EMI fields blank to value the loan on the gold alone.",
      ],
      "NO_EMI_HEADROOM",
    );
  }

  if (loan < MIN_GOLD_LOAN) {
    return Object.assign(
      holding(
        "Indicative gold loan",
        `This pledge values at ${money(value)}, which supports less than the ${money(MIN_GOLD_LOAN)} minimum gold loan.`,
        ["Pledge additional ornaments or check the rate per gram you entered."],
        "BELOW_MIN_LOAN",
      ),
      { caps, binding, roi, months, gold: { value, ltv, netWeight }, foir },
    );
  }

  return {
    eligible: true,
    headline: loan,
    headlineLabel: "Indicative gold loan",
    monthly: Math.round(emi),
    monthlyLabel: "Monthly EMI",
    roi,
    months,
    caps,
    binding,
    foir,
    message: `${Math.round(netWeight)} g of gold values at ${money(value)}; RBI's ${Math.round(ltv * 100)}% LTV allows ${money(loan)}.`,
    suggestions: [],
    reasonCode: null,
    gold: { value, ltv, netWeight },
  };
};

module.exports = { goldEligibility };
