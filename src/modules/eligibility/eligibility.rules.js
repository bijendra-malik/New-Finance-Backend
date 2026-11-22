/*
==========================================
Eligibility calculator rules (website ka /eligibility-calculator page)

Website par abhi ye hisaab browser me ho raha tha (income - EMI, fixed 60
mahine). Yahan wahi calculation server par hoti hai, par product-wise ROI aur
tenure ke saath — taaki ek hi rule book website, admin panel aur future me
franchise panel, sabke liye sach ho.

Rate card (ROI p.a. / max tenure):

  PL   12   5Y       BL   14   5Y       HL   8    30Y
  LAP  10.5 10Y      Project 10.5 5Y    VL   8    5Y
  EL   6    10Y      CP   12   10Y      WC   12.5 10Y
  LRD  12.5 10Y      GL   9    1Y       ODCC 10   1Y

Balance Transfer aur Credit Card ka ROI/tenure company-wide fix nahi hai
(lender ke offer par depend karta hai), isliye unke liye `roi: null` rehta hai —
calculator sirf eligibility batata hai, amount/EMI "team confirm karegi" kehta
hai. Koi number invent nahi kiya jaata.

Formula (standard reducing-balance EMI):

  net income   = monthly income - existing EMI
  max EMI      = net income × FOIR (50%)
  max loan     = max EMI ka present value, product ROI + tenure par
  EMI          = max loan par wahi formula (round-trip)

Tenure do cheezon se limit hota hai: product ki max tenure, aur applicant ki
age (loan 65 saal ki age tak hi chal sakta hai).
==========================================
*/

const FOIR_PERCENT = 50;
const MIN_NET_INCOME = 15000;
const MIN_AGE = 21;
const MAX_AGE = 65;
const MIN_LOAN_AMOUNT = 25000;
const ROUND_TO = 1000;

/*
Ek hi rate card — code stable hai (DB me yahi jaata hai), label UI ke liye.
`aliases` website ke purane labels ("Car Loan") ko map karte hain, taaki
frontend ko kuch rename karne ki zaroorat na pade.
*/
const ELIGIBILITY_PRODUCTS = [
  { code: "personal_loan", label: "Personal Loan", roi: 12, tenureMonths: 60, aliases: ["pl"] },
  { code: "business_loan", label: "Business Loan", roi: 14, tenureMonths: 60, aliases: ["bl"] },
  { code: "home_loan", label: "Home Loan", roi: 8, tenureMonths: 360, aliases: ["hl"] },
  { code: "loan_against_property", label: "Loan Against Property", roi: 10.5, tenureMonths: 120, aliases: ["lap"] },
  { code: "project_loan", label: "Project Loan", roi: 10.5, tenureMonths: 60 },
  { code: "vehicle_loan", label: "Vehicle Loan", roi: 8, tenureMonths: 60, aliases: ["car loan", "vl"] },
  { code: "education_loan", label: "Education Loan", roi: 6, tenureMonths: 120, aliases: ["el"] },
  { code: "commercial_purchase", label: "Commercial Purchase", roi: 12, tenureMonths: 120, aliases: ["cp"] },
  { code: "working_capital", label: "Working Capital", roi: 12.5, tenureMonths: 120, aliases: ["wc"] },
  { code: "lease_rental_discounting", label: "Lease Rental Discounting", roi: 12.5, tenureMonths: 120, aliases: ["lrd"] },
  { code: "gold_loan", label: "Gold Loan", roi: 9, tenureMonths: 12, aliases: ["gl"] },
  { code: "od_cc_limit", label: "OD / CC Limit", roi: 10, tenureMonths: 12, aliases: ["odcc", "od cc limit", "od cc"] },
  /* Rate on request — calculator amount/EMI nahi banata. */
  { code: "balance_transfer", label: "Balance Transfer", roi: null, tenureMonths: null, aliases: ["bt"] },
  { code: "credit_card", label: "Credit Card", roi: null, tenureMonths: null, aliases: ["cc"] },
];

const normalizeKey = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Product code / label / alias — teeno se ek hi product milta hai. */
const findProduct = (value) => {
  const key = normalizeKey(value);
  if (!key) return null;

  return (
    ELIGIBILITY_PRODUCTS.find((product) => {
      if (product.code === key.replace(/ /g, "_")) return true;
      if (normalizeKey(product.label) === key) return true;
      return (product.aliases || []).some((alias) => normalizeKey(alias) === key);
    }) ?? null
  );
};

/** Public rate card — frontend dropdown + ROI table isi se banata hai. */
const rateCard = () =>
  ELIGIBILITY_PRODUCTS.map(({ code, label, roi, tenureMonths }) => ({
    code,
    label,
    roi,
    tenureMonths,
    tenureYears: tenureMonths ? Math.round((tenureMonths / 12) * 10) / 10 : null,
    rateOnRequest: roi === null,
  }));

/** Pooray saal — DOB se aaj tak. */
const ageInYears = (dob, now = new Date()) => {
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
};

/** Age 65 tak jitne mahine bache hain (negative => 0). */
const monthsToAgeCap = (age) => Math.max(0, (MAX_AGE - age) * 12);

const monthlyEmi = (principal, roiPercent, months) => {
  if (!months) return 0;
  const monthlyRate = roiPercent / 12 / 100;
  if (!monthlyRate) return principal / months;
  const factor = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * factor) / (factor - 1);
};

/** Kitna principal aaj ke max EMI se affordable hai (EMI ka present value). */
const principalFromEmi = (emi, roiPercent, months) => {
  if (!months) return 0;
  const monthlyRate = roiPercent / 12 / 100;
  if (!monthlyRate) return emi * months;
  const factor = Math.pow(1 + monthlyRate, months);
  return (emi * (factor - 1)) / (monthlyRate * factor);
};

const roundDown = (value, step) => Math.floor(value / step) * step;

/**
 * Ek applicant + ek product ka pura hisaab.
 *
 * Input: { product, dateOfBirth, monthlyIncome, existingEmi }
 * Output: eligible, reason, age, netIncome, foirPercent, maxEmi, roi,
 *         tenureMonths, maxLoanAmount, emi — DB aur API dono yahi shape.
 */
const calculateEligibility = ({ product, dateOfBirth, monthlyIncome, existingEmi = 0 }) => {
  const age = ageInYears(dateOfBirth);
  const income = Math.max(0, Number(monthlyIncome) || 0);
  const emi = Math.max(0, Number(existingEmi) || 0);
  const netIncome = Math.max(0, income - emi);
  const maxEmi = Math.round((netIncome * FOIR_PERCENT) / 100);

  const base = {
    productCode: product.code,
    productLabel: product.label,
    roi: product.roi,
    tenureMonths: product.tenureMonths,
    age,
    monthlyIncome: income,
    existingEmi: emi,
    netIncome,
    foirPercent: FOIR_PERCENT,
    maxEmi,
    maxLoanAmount: null,
    emi: null,
  };

  const reject = (reason) => ({ ...base, eligible: false, reason, message: reason });

  if (age < MIN_AGE) {
    return reject(`Age must be at least ${MIN_AGE} years to apply.`);
  }
  if (age > MAX_AGE) {
    return reject(`Age must be ${MAX_AGE} years or below to apply.`);
  }
  if (netIncome < MIN_NET_INCOME) {
    return reject(
      `Your net monthly income after existing EMIs must be at least ₹${MIN_NET_INCOME.toLocaleString("en-IN")}.`
    );
  }

  /* Rate on request wale products: eligibility haan/naa, pricing team batayegi. */
  if (product.roi === null) {
    return {
      ...base,
      eligible: true,
      reason: null,
      message: `${product.label} is available on request — our team will confirm the rate, tenure and amount.`,
    };
  }

  /*
  Tenure: product ki max tenure, par loan applicant ke 65 saal hone se pehle
  khatam hoga. 6 mahine se kam bacha ho to product practically unavailable hai.
  */
  const tenureMonths = Math.min(product.tenureMonths, monthsToAgeCap(age));

  if (tenureMonths < 6) {
    return reject("The remaining tenure before age 65 is too short for this loan.");
  }

  const maxLoanAmount = roundDown(
    principalFromEmi(maxEmi, product.roi, tenureMonths),
    ROUND_TO
  );

  if (maxLoanAmount < MIN_LOAN_AMOUNT) {
    return reject("Your repayment capacity does not support the minimum loan amount for this product.");
  }

  const computedEmi = Math.round(monthlyEmi(maxLoanAmount, product.roi, tenureMonths));

  return {
    ...base,
    tenureMonths,
    maxLoanAmount,
    emi: computedEmi,
    eligible: true,
    reason: null,
    message:
      `Based on your income and existing obligations, you may be eligible for up to ` +
      `${maxLoanAmount.toLocaleString("en-IN")} for ${tenureMonths} months at ${product.roi}% p.a. ` +
      `(approx EMI ₹${computedEmi.toLocaleString("en-IN")}/month).`,
  };
};

module.exports = {
  ELIGIBILITY_PRODUCTS,
  FOIR_PERCENT,
  MIN_NET_INCOME,
  MIN_AGE,
  MAX_AGE,
  MIN_LOAN_AMOUNT,
  findProduct,
  rateCard,
  ageInYears,
  calculateEligibility,
  monthlyEmi,
  principalFromEmi,
};
