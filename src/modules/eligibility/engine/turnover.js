/* Working capital, turnover method — 1:1 port of eligibility/models/turnover.ts. */

const {
  MIN_LOAN,
  WC_ASSESSMENT_PCT,
  creditRefusal,
  holding,
  money,
  roundTo,
} = require("./core");

const turnoverEligibility = (input) => {
  const { product } = input;

  const refusal = creditRefusal(input.creditScore, "Indicative working capital limit");
  if (refusal) return refusal;

  const roi =
    input.roi !== undefined && Number.isFinite(input.roi) && input.roi >= 0 ? input.roi : product.roi;
  const turnover = Math.max(0, input.turnover);
  const pct = input.assessmentPct > 0 ? Math.min(100, input.assessmentPct) : WC_ASSESSMENT_PCT * 100;
  const margin = Math.max(0, input.margin);

  if (turnover <= 0) {
    return holding(
      "Indicative working capital limit",
      "Projected annual turnover is the starting point for a working-capital limit.",
      ["Use the turnover you expect in the next 12 months, not last year's audited figure."],
      "TURNOVER_MISSING",
    );
  }

  const requirement = turnover * (pct / 100);
  const mode = input.mode === "drawingPower" ? "drawingPower" : "turnover";

  const currentAssets = Math.max(0, input.currentAssets || 0);
  const currentLiabilities = Math.max(0, input.currentLiabilities || 0);
  const hasBalanceSheet = currentAssets > 0 || currentLiabilities > 0;
  const gap = Math.max(0, currentAssets - currentLiabilities);
  const assessed = roundTo(Math.max(0, requirement - margin), 1000);
  const borrowing = roundTo(Math.max(0, gap - margin), 1000);

  if (mode === "drawingPower" && !hasBalanceSheet) {
    return holding(
      "Indicative working capital limit",
      "The drawing-power method needs your current assets and current liabilities.",
      ["Add eligible current assets and current liabilities, or switch back to the turnover method."],
      "BALANCE_SHEET_MISSING",
    );
  }

  const value = mode === "drawingPower" ? Math.min(assessed, borrowing) : assessed;

  const caps = [
    { key: "turnover", label: `${Math.round(pct * 100) / 100}% of turnover, less margin`, value: assessed },
  ];
  if (mode === "drawingPower") {
    caps.push({ key: "drawing", label: "Current assets − current liabilities, less margin", value: borrowing });
  }
  const binding = caps.reduce((lowest, cap) => (cap.value < lowest.value ? cap : lowest)).label;

  if (value < MIN_LOAN) {
    return Object.assign(
      holding(
        "Indicative working capital limit",
        hasBalanceSheet
          ? `A ${money(gap)} gap between current assets and liabilities, less ${money(margin)} of margin, supports less than the ${money(MIN_LOAN)} banks open.`
          : `A ${money(requirement)} requirement less ${money(margin)} of margin leaves less than the ${money(MIN_LOAN)} banks open.`,
        ["A lower borrower's margin or a higher projected turnover lifts the limit."],
        "BELOW_MIN_LOAN",
      ),
      { caps, binding, roi, months: 12 },
    );
  }

  return {
    eligible: true,
    headline: value,
    headlineLabel: "Indicative working capital limit",
    monthly: Math.round(value * (roi / 1200)),
    monthlyLabel: "Interest at full draw",
    roi,
    months: 12,
    caps,
    binding,
    foir: null,
    message:
      mode === "drawingPower"
        ? `Current assets of ${money(currentAssets)} less ${money(currentLiabilities)} of current liabilities leave a ${money(gap)} gap; after ${money(margin)} of margin that is ${money(borrowing)}, against a turnover-based limit of ${money(assessed)}, so the limit is ${money(value)}.`
        : `A ${money(turnover)} turnover at ${Math.round(pct * 100) / 100}% needs ${money(requirement)} of working capital; after ${money(margin)} of margin, about ${money(value)} can be financed.`,
    suggestions: [],
    reasonCode: null,
  };
};

module.exports = { turnoverEligibility };
