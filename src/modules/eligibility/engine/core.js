/*
==========================================
Eligibility engine — core (1:1 port)

Source of truth: website ka eligibility/models/core.ts. Yahan formulas,
LTV slabs, messages aur rounding bilkul wahi hain — sirf TypeScript types
hataye gaye hain.

Ek hi extra field hai: `reasonCode`. UI ko iski zaroorat nahi, par API se
pata chalta hai ki applicant kis rule par ruka (CREDIT_SCORE_LOW,
NO_EMI_HEADROOM, BELOW_MIN_LOAN...).
==========================================
*/

const FOIR_CAP = 0.7;
const EDUCATION_FOIR_CAP = 0.7;
const VEHICLE_FOIR = 0.5;
const VEHICLE_LTV = 0.9;
const MIN_HEADROOM = 500;
const MIN_LOAN = 50000;
const MIN_GOLD_LOAN = 10000;
const TURNOVER_METHOD_CAP = 5 * 10000000; // ₹5 crore

const STOCK_MARGIN = 0.25;
const DEBTOR_MARGIN = 0.3;
const RENTAL_HAIRCUT = 0.75;

const DSCR_MIN = 1.25;
const COMMERCIAL_LTV = 0.7;
const WC_ASSESSMENT_PCT = 0.2;
const WC_TURNOVER_REQUIREMENT = 0.25;
const WC_BANK_SHARE = 0.75;
const WC_TURNOVER_NORM = WC_TURNOVER_REQUIREMENT * WC_BANK_SHARE; // 18.75%

const HOME_LTV_SLABS = [
  { upTo: 3000000, ltv: 0.9 },
  { upTo: 7500000, ltv: 0.8 },
  { upTo: Number.POSITIVE_INFINITY, ltv: 0.75 },
];

const GOLD_LTV_SLABS = [
  { upTo: 250000, ltv: 0.85 },
  { upTo: 500000, ltv: 0.8 },
  { upTo: Number.POSITIVE_INFINITY, ltv: 0.75 },
];

/* Website ke 13 products — key, ROI aur max tenure UI ke models se. */
const PRODUCTS = [
  { key: "personal", label: "Personal Loan", family: "term", roi: 12, maxTenureMonths: 60, unsecured: true },
  { key: "business", label: "Business Loan", family: "term", roi: 14, maxTenureMonths: 60, unsecured: true },
  {
    key: "home", label: "Home Loan", family: "term", roi: 8, maxTenureMonths: 360, maturityAge: 70,
    asset: {
      field: "propertyValue",
      label: "Property Market Value",
      hint: "Up to 90% of the property market value",
      ltv: 0.9,
      ltvSlabs: HOME_LTV_SLABS,
    },
  },
  {
    key: "lap", label: "Loan Against Property", family: "term", roi: 10.5, maxTenureMonths: 120,
    asset: {
      field: "propertyValue",
      label: "Property Market Value",
      hint: "Up to 65% of the property market value",
      ltv: 0.65,
      ltvByType: { Residential: 0.8, Commercial: 0.7, Industrial: 0.65 },
      ltvForOtherType: 0.7,
      cityAdjustment: { A: 0, B: 0.05, C: 0.1 },
    },
  },
  {
    key: "vehicleLoan", label: "Vehicle Loan", family: "term", roi: 8, maxTenureMonths: 60,
    asset: { field: "vehiclePrice", label: "On-Road Vehicle Price", hint: "Up to 90% of the on-road price", ltv: 0.9 },
  },
  { key: "educationLoan", label: "Education Loan", family: "education", roi: 6, maxTenureMonths: 120, unsecured: true },
  { key: "projectLoan", label: "Project Loan", family: "project", roi: 10.5, maxTenureMonths: 60 },
  { key: "commercialPurchase", label: "Commercial Purchase", family: "commercial", roi: 12, maxTenureMonths: 120 },
  { key: "workingCapital", label: "Working Capital", family: "turnover", roi: 12.5, maxTenureMonths: 12 },
  { key: "leaseRentalDiscounting", label: "Lease Rental Discounting", family: "lrd", roi: 10.5, maxTenureMonths: 120 },
  { key: "odCcLimit", label: "OD / CC Limit", family: "wc", roi: 10, maxTenureMonths: 12 },
  { key: "goldLoan", label: "Gold Loan", family: "gold", roi: 9, maxTenureMonths: 12 },
  { key: "loanAgainstShares", label: "Loan Against Shares", family: "share", roi: 11, maxTenureMonths: 120 },
];

/* ── Money maths ─────────────────────────────────────────────────────────── */

const principalForEmi = (emi, annualRate, months) => {
  if (months <= 0 || emi <= 0) return 0;
  const r = annualRate / 1200;
  if (r === 0) return emi * months;
  const growth = Math.pow(1 + r, months);
  return (emi * (growth - 1)) / (r * growth);
};

const emiForPrincipal = (principal, annualRate, months) => {
  if (months <= 0 || principal <= 0) return 0;
  const r = annualRate / 1200;
  if (r === 0) return principal / months;
  const growth = Math.pow(1 + r, months);
  return (principal * r * growth) / (growth - 1);
};

const roundTo = (value, step) => Math.max(0, Math.floor(value / step) * step);

const money = (value) => `₹${Math.round(value).toLocaleString("en-IN")}`;

/* ── Asset LTV ───────────────────────────────────────────────────────────── */

const assetLtvFor = (asset, value, type, city) => {
  let ltv = asset.ltv;
  if (type && asset.ltvByType) {
    ltv = asset.ltvByType[type] !== undefined
      ? asset.ltvByType[type]
      : asset.ltvForOtherType !== undefined
        ? asset.ltvForOtherType
        : Math.min(...Object.values(asset.ltvByType));
  }
  if (asset.ltvSlabs && value > 0) {
    const slab = asset.ltvSlabs.find(({ upTo, ltv: slabLtv }) => value * slabLtv <= upTo);
    if (slab) ltv = slab.ltv;
  }
  if (city && asset.cityAdjustment) ltv -= asset.cityAdjustment[city] || 0;
  return Math.max(0.3, ltv);
};

const goldLtvFor = (value) => {
  if (value <= 0) return 0;
  const slab = GOLD_LTV_SLABS.find(({ upTo, ltv }) => value * ltv <= upTo);
  return slab ? slab.ltv : 0.75;
};

/* ── Age / tenure ────────────────────────────────────────────────────────── */

const retirementAgeFor = (occupation) => (occupation === "Salaried" ? 60 : 65);

const maturityAgeFor = (product, occupation) =>
  product.maturityAge !== undefined ? product.maturityAge : retirementAgeFor(occupation);

const monthsToMaturity = (age, product, occupation) =>
  Math.max(0, (maturityAgeFor(product, occupation) - age) * 12);

/* Form ka tenure: gold hamesha 12, baaki product max aur maturity ka min. */
const maxTenureFor = (product, age, occupation) => {
  if (product.family === "gold") return 12;
  return Math.max(12, Math.min(product.maxTenureMonths, monthsToMaturity(age, product, occupation) || 12));
};

const tenureText = (months) => {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (rest) parts.push(`${rest} ${rest === 1 ? "month" : "months"}`);
  return parts.join(" ") || "0 months";
};

/* ── Outcome helpers ─────────────────────────────────────────────────────── */

const holding = (headlineLabel, message, suggestions, reasonCode) => ({
  eligible: false,
  headline: 0,
  headlineLabel,
  monthly: 0,
  monthlyLabel: "Monthly EMI",
  roi: 0,
  months: 0,
  caps: [],
  binding: null,
  foir: null,
  message,
  suggestions,
  reasonCode: reasonCode || "NOT_ELIGIBLE",
});

/* ── Credit score policy ─────────────────────────────────────────────────── */

const CREDIT_SCORE_FLOOR = 650;

const creditPolicyFor = (score) => {
  if (!Number.isFinite(score) || score <= 0) return null;
  if (score >= 750) return { band: "750 and above, excellent", foirCap: 0.65, securedFoirCap: 0.7, eligible: true };
  if (score >= 700) return { band: "700 to 749, good", foirCap: 0.55, securedFoirCap: 0.65, eligible: true };
  if (score >= CREDIT_SCORE_FLOOR) return { band: "650 to 699, fair", foirCap: 0.45, securedFoirCap: 0.6, eligible: true };
  return { band: `under ${CREDIT_SCORE_FLOOR}`, foirCap: 0, securedFoirCap: 0, eligible: false };
};

const creditRefusal = (score, headlineLabel) => {
  const policy = creditPolicyFor(score || 0);
  if (!policy) {
    return holding(
      headlineLabel,
      "Add your credit bureau score and we will estimate the loan you can service.",
      ["A score of 750 or above usually gets the widest repayment room and the best rate."],
      "CREDIT_SCORE_MISSING",
    );
  }
  if (!policy.eligible) {
    return holding(
      headlineLabel,
      `A score of ${Math.round(score || 0)} sits below the ${CREDIT_SCORE_FLOOR} most lenders need to sanction a loan.`,
      [
        "Clear overdue dues, keep card utilisation under 30% and check the report for errors.",
        "A secured loan on property, gold or shares is judged on the asset rather than the score.",
      ],
      "CREDIT_SCORE_LOW",
    );
  }
  return null;
};

module.exports = {
  FOIR_CAP,
  EDUCATION_FOIR_CAP,
  VEHICLE_FOIR,
  VEHICLE_LTV,
  MIN_HEADROOM,
  MIN_LOAN,
  MIN_GOLD_LOAN,
  TURNOVER_METHOD_CAP,
  STOCK_MARGIN,
  DEBTOR_MARGIN,
  RENTAL_HAIRCUT,
  DSCR_MIN,
  COMMERCIAL_LTV,
  WC_ASSESSMENT_PCT,
  WC_TURNOVER_NORM,
  CREDIT_SCORE_FLOOR,
  PRODUCTS,
  principalForEmi,
  emiForPrincipal,
  roundTo,
  money,
  assetLtvFor,
  goldLtvFor,
  maturityAgeFor,
  monthsToMaturity,
  maxTenureFor,
  tenureText,
  holding,
  creditPolicyFor,
  creditRefusal,
};
