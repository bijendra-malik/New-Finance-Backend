/*
Term loans — Personal, Business, Home, LAP, Vehicle.
1:1 port of eligibility/models/term.ts.
*/

const {
  MIN_HEADROOM,
  MIN_LOAN,
  FOIR_CAP,
  RENTAL_HAIRCUT,
  VEHICLE_LTV,
  assetLtvFor,
  creditPolicyFor,
  creditRefusal,
  emiForPrincipal,
  holding,
  money,
  monthsToMaturity,
  maturityAgeFor,
  principalForEmi,
  roundTo,
  tenureText,
} = require("./core");

const termEligibility = (input) => {
  const { product, monthlyIncome, existingEmi, age, occupation } = input;

  const refusal = creditRefusal(input.creditScore, "Indicative loan amount");
  if (refusal) return refusal;

  const credit = creditPolicyFor(input.creditScore || 0);
  const isPersonal = product.key === "personal";
  const isVehicle = product.key === "vehicleLoan";
  const rental = Math.max(0, input.rentalIncome || 0) * RENTAL_HAIRCUT;
  const income = monthlyIncome + rental;
  const existing = existingEmi;
  const roi = input.roi && input.roi > 0 ? input.roi : product.roi;

  const foirCap = FOIR_CAP;
  const emiCap = income * foirCap;
  const headroom = Math.max(0, emiCap - existing);
  const months = Math.min(product.maxTenureMonths, input.tenureMonths, monthsToMaturity(age, product, occupation));

  if (income <= 0) {
    return holding(
      "Indicative loan amount",
      "Add your net monthly income and we will estimate the loan you can service.",
      ["Include only the take-home amount that reaches your bank account."],
      "INCOME_MISSING",
    );
  }

  if (headroom < MIN_HEADROOM) {
    return holding(
      "Indicative loan amount",
      existing > 0
        ? `Your existing EMIs of ${money(existing)} use up the income lenders will count, leaving no room for a new one.`
        : "This income does not leave enough room for a new EMI.",
      ["Closing or part-pre-paying an existing loan frees up EMI headroom."],
      "NO_EMI_HEADROOM",
    );
  }

  if (months <= 0) {
    return holding(
      "Indicative loan amount",
      `Repayment has to end by age ${maturityAgeFor(product, occupation)}, and at your age there is no tenure left.`,
      ["Most lenders will not sanction a fresh loan of this type at your age."],
      "AGE_TENURE_OVER",
    );
  }

  if (months < 12) {
    return holding(
      "Indicative loan amount",
      `Repayment has to end by age ${maturityAgeFor(product, occupation)}, which leaves less than a year of tenure.`,
      ["A smaller loan amount can still be repaid within the time left."],
      "TENURE_TOO_SHORT",
    );
  }

  const capacity = principalForEmi(headroom, roi, months);
  const capacityAmount = isPersonal ? Math.floor(capacity) : roundTo(capacity, 1000);
  const caps = [{ key: "foir", label: "Repayment capacity", value: capacityAmount }];

  if (product.asset && input.assetValue > 0) {
    const vehicleLtvPct = Math.min(100, Math.max(50, input.ltvPct !== undefined ? input.ltvPct : VEHICLE_LTV * 100));
    const effectiveLtv = isVehicle
      ? vehicleLtvPct / 100
      : assetLtvFor(product.asset, input.assetValue, input.assetType, input.cityCategory);
    let secured = Math.max(0, input.assetValue * effectiveLtv - Math.max(0, input.existingLoanOnAsset || 0));
    let assetLabel = `${product.asset.label.replace("Annual ", "")} × ${Math.round(effectiveLtv * 100)}%`;
    if (product.asset.field === "vehiclePrice") {
      const afterDownPayment = Math.max(0, input.assetValue - Math.max(0, input.downPayment || 0));
      if (afterDownPayment < secured) {
        secured = afterDownPayment;
        assetLabel = "On-road price less down payment";
      }
    }
    caps.push({ key: "asset", label: assetLabel, value: roundTo(secured, 1000) });
  }

  const loan = Math.min(...caps.map((cap) => cap.value));
  const binding = caps.reduce((lowest, cap) => (cap.value < lowest.value ? cap : lowest)).label;
  const emi = emiForPrincipal(loan, roi, months);

  if (loan < MIN_LOAN) {
    return Object.assign(
      holding(
        "Indicative loan amount",
        `On these figures the limit comes to under ${money(MIN_LOAN)}, the smallest most lenders will sanction.`,
        product.asset
          ? [`Declare a higher ${product.asset.label.toLowerCase()}.`]
          : ["A smaller loan amount brings the EMI within reach."],
        "BELOW_MIN_LOAN",
      ),
      { caps, binding, months, roi },
    );
  }

  return {
    eligible: true,
    headline: loan,
    headlineLabel: "Indicative loan amount",
    monthly: Math.round(emi),
    monthlyLabel: "Monthly EMI",
    roi,
    months,
    caps,
    binding,
    foir: {
      used: income > 0 ? (existing + emi) / income : 0,
      headroom: Math.max(0, headroom - emi),
      income,
      existing,
    },
    credit: credit ? { score: Math.round(input.creditScore || 0), band: credit.band, foirCap } : undefined,
    message: `You can service about ${money(loan)} at ${roi}% p.a. over ${tenureText(months)}.`,
    suggestions: [],
    reasonCode: null,
  };
};

module.exports = { termEligibility };
