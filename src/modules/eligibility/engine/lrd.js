/* Lease rental discounting — 1:1 port of eligibility/models/lrd.ts. */

const {
  DSCR_MIN,
  MIN_LOAN,
  WC_ASSESSMENT_PCT,
  creditRefusal,
  emiForPrincipal,
  holding,
  money,
  roundTo,
  tenureText,
} = require("./core");

const LRD_LTV_MIN = 0.5;
const LRD_LTV_MAX = 0.9;
const LRD_DEFAULT_LTV = 0.7;
const LRD_ROI = 10.5;
const LRD_TENURE_YEARS = 10;
const LRD_DEFAULT_DEDUCTION = 0.1;
const LRD_DEFAULT_COVERAGE = 0.7;

const presentValueOfAnnuity = (payment, annualRate, months) => {
  if (payment <= 0 || months <= 0) return 0;
  const monthlyRate = annualRate / 1200;
  if (monthlyRate <= 0) return payment * months;
  return (payment * (1 - Math.pow(1 + monthlyRate, -months))) / monthlyRate;
};

const lrdEligibility = (input) => {
  const { product } = input;

  const refusal = creditRefusal(input.creditScore, "Indicative lease rental loan");
  if (refusal) return refusal;

  const roi =
    input.roi !== undefined && Number.isFinite(input.roi) && input.roi >= 0 ? input.roi : product.roi;
  const rent = Math.max(0, input.monthlyRent);
  const leaseMonths = Math.max(0, Math.round(input.leaseMonths));
  const propertyValue = Math.max(0, input.propertyValue);
  const ltv = Math.min(LRD_LTV_MAX, Math.max(LRD_LTV_MIN, (input.ltvPercent || LRD_DEFAULT_LTV * 100) / 100));
  const months = Math.min(
    Math.max(0, Math.round(input.repaymentMonths)),
    leaseMonths,
    product.maxTenureMonths,
  );

  if (rent <= 0 || leaseMonths <= 0 || propertyValue <= 0 || months <= 0) {
    return holding(
      "Indicative lease rental loan",
      "Add the rent your tenant pays, the lease left to run and the property's market value, and we will value that rental stream.",
      [
        "Only a registered lease with a creditworthy tenant is discounted.",
        "Rent is discounted for the time value of money, not added up as it stands.",
      ],
      "LEASE_DETAILS_MISSING",
    );
  }

  const deduction = Math.min(50, Math.max(0, input.deductionPct !== undefined ? input.deductionPct : LRD_DEFAULT_DEDUCTION * 100)) / 100;
  const coverage = Math.min(100, Math.max(20, input.coveragePct !== undefined ? input.coveragePct : LRD_DEFAULT_COVERAGE * 100)) / 100;
  const netRent = rent * (1 - deduction);
  const supportedEmi = netRent * coverage;
  const annualRent = rent * 12;
  const discountedRent = presentValueOfAnnuity(supportedEmi, roi, leaseMonths);
  const rentalLimit = roundTo(discountedRent, 1000);
  const propertyLimit = roundTo(propertyValue * ltv, 1000);
  const value = Math.min(rentalLimit, propertyLimit);
  const emi = emiForPrincipal(value, roi, months);
  const lease = {
    rent,
    annualRent,
    leaseMonths,
    propertyValue,
    ltv,
    discountedRent,
    rentalLimit,
    propertyLimit,
    netRent,
    supportedEmi,
    interest: Math.max(0, Math.round(emi * months - value)),
  };
  const caps = [
    {
      key: "lease",
      label: `Rent after ${Math.round(deduction * 100)}% deduction at ${Math.round(coverage * 100)}% coverage`,
      value: rentalLimit,
    },
    { key: "asset", label: `${Math.round(ltv * 100)}% of the property value`, value: propertyLimit },
  ];
  const binding = rentalLimit <= propertyLimit ? caps[0].label : caps[1].label;

  if (value < MIN_LOAN) {
    return Object.assign(
      holding(
        "Indicative lease rental loan",
        `On this rent, lease and property the limit comes to under ${money(MIN_LOAN)}, the smallest most lenders will sanction.`,
        ["A longer lease, a higher rent or a more valuable property supports a larger loan."],
        "BELOW_MIN_LOAN",
      ),
      { roi, months, lease },
    );
  }

  return {
    eligible: true,
    headline: value,
    headlineLabel: "Indicative lease rental loan",
    monthly: Math.round(emi),
    monthlyLabel: "Monthly EMI",
    roi,
    months,
    caps,
    binding,
    foir: {
      used: netRent > 0 ? emi / netRent : 0,
      headroom: Math.max(0, supportedEmi - emi),
      income: netRent,
      existing: 0,
    },
    message: `Rent of ${money(rent)} a month less a ${Math.round(deduction * 100)}% deduction leaves ${money(netRent)}; at ${Math.round(coverage * 100)}% coverage the EMI can be ${money(supportedEmi)}, which discounts to ${money(rentalLimit)} over the remaining lease at ${roi}% p.a. The ${money(propertyValue)} property caps lending at ${money(propertyLimit)}, so the estimate is ${money(value)}, repayable at about ${money(emi)} a month over ${tenureText(months)}.`,
    suggestions: [],
    reasonCode: null,
    lease,
  };
};

const formulaFor = (family) => {
  switch (family) {
    case "education":
      return "Loan = course fees + hostel and living costs + other eligible expenses − scholarships − margin money";
    case "project":
      return `Loan = min(project cost − promoter contribution, principal serviced by projected cash flow at a ${DSCR_MIN}× DSCR)`;
    case "commercial":
      return "Loan = min(repayment capacity at the assumed FOIR, property value × LTV, DSCR limit on the rent)";
    case "turnover":
      return `Turnover method: requirement = turnover × ${Math.round(WC_ASSESSMENT_PCT * 10000) / 100}%, less margin · Drawing power = current assets − current liabilities − margin · Limit = min(turnover norm, drawing power)`;
    case "wc":
      return "Turnover method: requirement = turnover × 25%, bank finance = requirement × 75% (18.75% of turnover) · Drawing power = eligible stock + eligible receivables − margin − deductions · Limit = min(turnover norm, drawing power)";
    case "lrd":
      return "Net rent = rent × (1 − deduction) · Supported EMI = net rent × coverage · Loan = min(present value of that EMI over the remaining lease, property value × LTV)";
    case "share":
      return "Loan = market value of approved shares × LTV (50%)";
    case "gold":
      return "Value = net weight × today's rate for the selected purity · Loan = value × LTV (85% ≤ ₹2.5L, 80% ≤ ₹5L, 75% above)";
    default:
      return "Loan = present value of the affordable EMI at the product rate and tenure";
  }
};

module.exports = {
  LRD_LTV_MIN,
  LRD_LTV_MAX,
  LRD_ROI,
  LRD_TENURE_YEARS,
  lrdEligibility,
  formulaFor,
};
