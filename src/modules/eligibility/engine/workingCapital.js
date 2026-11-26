/* OD / CC working capital — 1:1 port of eligibility/models/workingCapital.ts. */

const {
  DEBTOR_MARGIN,
  MIN_LOAN,
  STOCK_MARGIN,
  TURNOVER_METHOD_CAP,
  WC_TURNOVER_NORM,
  creditRefusal,
  holding,
  money,
  roundTo,
} = require("./core");

const workingCapitalEligibility = (input) => {
  const { product, turnover } = input;

  const refusal = creditRefusal(input.creditScore, "Indicative drawing power");
  if (refusal) return refusal;

  const roi = input.roi && input.roi > 0 ? input.roi : product.roi;
  const stock = Math.max(0, input.stock);
  const debtors = Math.max(0, input.debtors);
  const otherCurrentLiabilities = Math.max(0, input.otherCurrentLiabilities);
  const currentAssets = stock + debtors;
  const workingCapitalGap = currentAssets - otherCurrentLiabilities;

  const margin = Math.max(0, input.margin || 0);
  const mode = input.mode === "drawingPower" ? "drawingPower" : "turnover";
  const turnoverLimit = roundTo(turnover * WC_TURNOVER_NORM, 1000);
  const drawingPower = roundTo(
    Math.max(0, stock * (1 - STOCK_MARGIN) + debtors * (1 - DEBTOR_MARGIN) - margin),
    1000,
  );
  const mpbfMethodI = roundTo(Math.max(0, 0.75 * workingCapitalGap), 1000);
  const mpbfMethodII = roundTo(Math.max(0, 0.75 * currentAssets - otherCurrentLiabilities), 1000);
  const mpbf = Math.min(mpbfMethodI, mpbfMethodII);
  const hasBalanceSheet = currentAssets > 0 || otherCurrentLiabilities > 0;

  if (turnover <= 0) {
    return holding(
      "Indicative OD / CC limit",
      "Projected annual turnover is the starting point for a working-capital limit.",
      ["Use the turnover you expect in the next 12 months, not last year's audited figure."],
      "TURNOVER_MISSING",
    );
  }

  const withinTurnoverMethod = turnover <= TURNOVER_METHOD_CAP;

  if (mode === "drawingPower" && !hasBalanceSheet) {
    return holding(
      "Indicative OD / CC limit",
      "The drawing-power method needs the stock and receivables the bank can charge.",
      ["Add your stock and payments due from customers, or switch back to the turnover method."],
      "BALANCE_SHEET_MISSING",
    );
  }

  const caps = [
    { key: "turnover", label: `Turnover method (${Math.round(WC_TURNOVER_NORM * 10000) / 100}%)`, value: turnoverLimit },
  ];
  if (mode === "drawingPower") {
    caps.push({ key: "drawing", label: "Drawing power on stock and receivables", value: drawingPower });
  }

  const limit = Math.min(...caps.map((cap) => cap.value));
  const binding = caps.reduce((lowest, cap) => (cap.value < lowest.value ? cap : lowest)).label;
  const usable = hasBalanceSheet ? Math.min(drawingPower, limit) : limit;
  const currentRatio = currentAssets / (otherCurrentLiabilities + limit || 1);
  const monthlyInterest = Math.round(usable * (roi / 1200));

  const workCapital = {
    turnoverLimit,
    mpbf,
    mpbfMethodI,
    mpbfMethodII,
    drawingPower,
    usable,
    currentRatio,
    currentRatioRequired: 1.33,
  };

  if (limit < MIN_LOAN) {
    return Object.assign(
      holding(
        "Indicative OD / CC limit",
        `These figures support less than ${money(MIN_LOAN)}, below the smallest working-capital limit banks open.`,
        ["A higher projected turnover, or stronger current assets, lifts both the turnover norm and MPBF."],
        "BELOW_MIN_LOAN",
      ),
      { caps, binding, roi, months: 12, workCapital },
    );
  }

  return {
    eligible: true,
    headline: limit,
    headlineLabel: "Indicative sanctioned limit",
    monthly: monthlyInterest,
    monthlyLabel: "Interest at full draw",
    roi,
    months: 12,
    caps,
    binding,
    foir: null,
    message:
      mode === "drawingPower"
        ? `The ${money(limit)} limit is the lower of the turnover norm (${money(turnoverLimit)}) and the ${money(drawingPower)} drawing power on stock and receivables after ${money(margin)} of margin.`
        : `A ${money(limit)} limit is ${Math.round(WC_TURNOVER_NORM * 10000) / 100}% of your ${money(turnover)} turnover${hasBalanceSheet ? `, with ${money(usable)} drawable against stock and debtors` : ""}.`,
    suggestions: [
      ...(hasBalanceSheet && currentRatio < 1.33
        ? ["A current ratio below 1.33:1 usually needs more long-term funds in the business before sanction."]
        : []),
      ...(!withinTurnoverMethod
        ? [`Above ${money(TURNOVER_METHOD_CAP)} of turnover the turnover norm is only indicative; banks usually assess such cases on MPBF or a cash budget.`]
        : []),
    ],
    reasonCode: null,
    workCapital,
  };
};

module.exports = { workingCapitalEligibility };
