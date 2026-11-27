/*
==========================================
Eligibility input — flat website form ka mapping

Website ka form `FormState` flat hai (monthlyIncome, propertyValue, goldGrams,
turnover...). API bhi wahi field names leta hai — nested `inputs` nahi — taaki
frontend ko form state jaisa hi body bhejni pade.

Yahan wahi validation hai jo page ke handleSubmit() me hai, wahi defaults
(INITIAL_FORM) aur wahi `num()` behaviour: blank / negative / NaN => 0.
==========================================
*/

const { PRODUCTS } = require("./engine/core");
const { LRD_LTV_MIN, LRD_LTV_MAX } = require("./engine/lrd");

const MOBILE_REGEX = /^[6-9]\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_AGE = 18;
const MAX_AGE = 65;

/* UI keys hi asli keys hain; purane code/label bhi accept hote hain. */
const LEGACY_CODES = {
  personal: "personal_loan",
  business: "business_loan",
  home: "home_loan",
  lap: "loan_against_property",
  vehicleLoan: "vehicle_loan",
  educationLoan: "education_loan",
  projectLoan: "project_loan",
  commercialPurchase: "commercial_purchase",
  workingCapital: "working_capital",
  leaseRentalDiscounting: "lease_rental_discounting",
  odCcLimit: "od_cc_limit",
  goldLoan: "gold_loan",
  loanAgainstShares: "loan_against_shares",
};

/* Sirf chhote codes yahan; poore purane codes (personal_loan...) LEGACY_CODES se banate hain. */
const SHORT_CODES = {
  pl: "personal",
  bl: "business",
  hl: "home",
  "car loan": "vehicleLoan",
  vl: "vehicleLoan",
  el: "educationLoan",
  cp: "commercialPurchase",
  wc: "workingCapital",
  lrd: "leaseRentalDiscounting",
  odcc: "odCcLimit",
  "od cc": "odCcLimit",
  gl: "goldLoan",
  las: "loanAgainstShares",
};

const PRODUCT_ALIASES = {
  ...Object.fromEntries(Object.entries(LEGACY_CODES).map(([key, code]) => [code, key])),
  ...SHORT_CODES,
};

const INCOME_LABELS = {
  Salaried: "Monthly income",
  "Self-Employed": "Monthly net profit",
  "Business Owner": "Monthly net profit",
};

/* INITIAL_FORM ke wahi defaults jo calculation me use hote hain. */
const FORM_DEFAULTS = {
  lapPropertyType: "Residential",
  lapCity: "A",
  lapUsage: "Self-occupied",
  vehicleLtv: 90,
  commercialLtv: 70,
  projectDscr: 1.25,
  wcAssessment: 18.75,
  lrdDeduction: 10,
  lrdCoverage: 70,
  odMode: "turnover",
  wcMethod: "turnover",
  goldCarat: 22,
};

const text = (value) => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

/* Wahi behaviour jo website ka num() deta hai: sirf positive finite. */
const num = (value) => {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  const parsed = Number.parseFloat(text(value).replace(/[,₹\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const withDefault = (body, key) => {
  const raw = text(body[key]);
  return raw === "" ? FORM_DEFAULTS[key] : num(body[key]);
};

const normalizeLabel = (value) =>
  text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const resolveProduct = (value) => {
  const raw = text(value);
  if (!raw) return null;

  const direct = PRODUCTS.find((product) => product.key === raw);
  if (direct) return direct;

  const label = normalizeLabel(raw);
  const byLabel = PRODUCTS.find((product) => normalizeLabel(product.label) === label);
  if (byLabel) return byLabel;

  /* Purane codes (personal_loan) PRODUCT_ALIASES me LEGACY_CODES se hi aate hain. */
  const alias = PRODUCT_ALIASES[label] || PRODUCT_ALIASES[label.replace(/ /g, "_")];
  return alias ? PRODUCTS.find((product) => product.key === alias) || null : null;
};

const legacyCodeFor = (key) => LEGACY_CODES[key] || key;

/* Website page slug: personal -> personal-loan, lap -> loan-against-property. */
const productSlug = (key) => legacyCodeFor(key).replace(/_/g, "-");

/* "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY" ya dobDD/dobMM/dobYYYY. */
const parseDateOfBirth = (body = {}) => {
  const raw = text(body.dob ?? body.dateOfBirth ?? body.dobDate);
  const dd = text(body.dobDD ?? body.dobDay);
  const mm = text(body.dobMM ?? body.dobMonth);
  const yyyy = text(body.dobYYYY ?? body.dobYear);

  let parts = null;
  if (dd && mm && yyyy) {
    parts = [dd, mm, yyyy];
  } else if (raw) {
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) parts = [iso[3], iso[2], iso[1]];
    else {
      const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (dmy) parts = [dmy[1], dmy[2], dmy[3]];
    }
  }

  if (!parts) return null;

  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);
  if (!day || !month || !year) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  /* 31 Feb roll over ho jaati hai — usse reject karo. */
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

/* Pooray saal — DOB se aaj tak. */
const ageOn = (date, now = new Date()) => {
  let age = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) age -= 1;
  return age;
};

const badRequest = (errors) => {
  const first = Object.values(errors)[0] || "Invalid eligibility input";
  const error = new Error(first);
  error.statusCode = 400;
  error.code = "VALIDATION_ERROR";
  error.errors = errors;
  return error;
};

const readConsent = (value) => value === true || value === "true" || value === "yes" || value === 1;

/**
 * Flat body -> validated input.
 * Throw 400 (errors object ke saath) jab koi field page ki tarah invalid ho.
 */
const normalizeInput = (body = {}, productKey) => {
  /* Product-scoped route path se product deta hai; path hi final hota hai. */
  const productInput = productKey ?? body.product ?? body.productCode ?? body.loanProduct;
  const product = resolveProduct(productInput);
  const occupationRaw = text(body.occupation);
  const occupation =
    product && product.key === "personal"
      ? "Salaried"
      : product && product.key === "business" && (occupationRaw === "Salaried" || !occupationRaw)
        ? "Self-Employed"
        : occupationRaw || "Salaried";

  const dateOfBirth = parseDateOfBirth(body);
  const age = dateOfBirth ? ageOn(dateOfBirth) : null;

  const lapPropertyType = text(body.lapPropertyType) || FORM_DEFAULTS.lapPropertyType;
  const lapPropertyOther = text(body.lapPropertyOther);

  const inputs = {
    age: age === null ? 0 : age,
    occupation,
    creditScore: num(body.creditScore),
    monthlyIncome: num(body.monthlyIncome ?? body.income),
    existingEmi: num(body.existingEmi ?? body.emi),
    propertyValue: num(body.propertyValue),
    turnover: num(body.turnover),
    vehiclePrice: num(body.vehiclePrice),
    lapPropertyType,
    lapPropertyOther,
    lapAssetType:
      lapPropertyType === "Other" ? lapPropertyOther || "Other" : lapPropertyType,
    lapCity: text(body.lapCity) || FORM_DEFAULTS.lapCity,
    lapUsage: text(body.lapUsage) || FORM_DEFAULTS.lapUsage,
    lapRent: num(body.lapRent),
    lapExistingLoan: num(body.lapExistingLoan),
    lrdRent: num(body.lrdRent),
    lrdLeaseYears: num(body.lrdLeaseYears),
    lrdPropertyValue: num(body.lrdPropertyValue),
    lrdLtv: num(body.lrdLtv),
    lrdDeduction: withDefault(body, "lrdDeduction"),
    lrdCoverage: withDefault(body, "lrdCoverage"),
    vehicleDownPayment: num(body.vehicleDownPayment),
    vehicleLtv: withDefault(body, "vehicleLtv"),
    eduFees: num(body.eduFees),
    eduHostel: num(body.eduHostel),
    eduOther: num(body.eduOther),
    eduScholarship: num(body.eduScholarship),
    eduMargin: num(body.eduMargin),
    projectCost: num(body.projectCost),
    projectContribution: num(body.projectContribution),
    projectCashFlow: num(body.projectCashFlow),
    projectDscr: withDefault(body, "projectDscr"),
    commercialRent: num(body.commercialRent),
    commercialCoApplicant: num(body.commercialCoApplicant),
    commercialLtv: withDefault(body, "commercialLtv"),
    wcAssessment: withDefault(body, "wcAssessment"),
    wcMargin: num(body.wcMargin),
    wcCurrentAssets: num(body.wcCurrentAssets),
    wcCurrentLiabilities: num(body.wcCurrentLiabilities),
    wcMethod: text(body.wcMethod) || FORM_DEFAULTS.wcMethod,
    odMode: text(body.odMode) || FORM_DEFAULTS.odMode,
    odMargin: num(body.odMargin),
    goldGrams: num(body.goldGrams),
    goldCarat: num(body.goldCarat) || FORM_DEFAULTS.goldCarat,
    goldRate: num(body.goldRate),
    stock: num(body.stock),
    debtors: num(body.debtors),
    otherCurrentLiabilities: num(body.otherCurrentLiabilities),
    shareValue: num(body.shareValue),
  };

  const fullName = text(body.fullName ?? body.name);
  const mobile = text(body.mobile ?? body.mobileNumber ?? body.phone).replace(/\D/g, "");
  const rawDob = text(body.dob ?? body.dateOfBirth ?? body.dobDate);
  const dobParts = text(body.dobDD ?? body.dobDay);
  const email = text(body.email ?? body.emailAddress).toLowerCase();
  const authorized = readConsent(body.authorized ?? body.consent);

  const errors = {};
  const family = product ? product.family : null;

  if (!text(productInput)) {
    errors.product = "Select a loan product";
  } else if (!product) {
    errors.product = `Unknown loan product. Supported: ${PRODUCTS.map((p) => p.label).join(", ")}`;
  }

  if (family === "term") {
    if (inputs.monthlyIncome <= 0) {
      const label = INCOME_LABELS[occupation] || INCOME_LABELS.Salaried;
      errors.monthlyIncome = `Enter your ${label.toLowerCase()}`;
    }
    if (product.asset && inputs[product.asset.field] <= 0) {
      errors[product.asset.field] = `Enter the ${product.asset.label.toLowerCase()}`;
    }
    if (product.key === "lap" && lapPropertyType === "Other" && !lapPropertyOther) {
      errors.lapPropertyOther = "Name the property type";
    }
  }

  if (family === "lrd") {
    if (inputs.lrdRent <= 0) errors.lrdRent = "Enter the monthly rent your tenant pays";
    if (inputs.lrdLeaseYears <= 0) errors.lrdLeaseYears = "Enter the lease left to run in years";
    if (inputs.lrdPropertyValue <= 0) errors.lrdPropertyValue = "Enter the property's market value";
    if (inputs.lrdLtv <= 0) errors.lrdLtv = "Enter the assumed LTV";
    else if (inputs.lrdLtv < LRD_LTV_MIN * 100 || inputs.lrdLtv > LRD_LTV_MAX * 100) {
      errors.lrdLtv = `Lenders fund ${LRD_LTV_MIN * 100}% to ${LRD_LTV_MAX * 100}% of the discounted rent`;
    }
  }

  if (family === "education" && inputs.eduFees <= 0) {
    errors.eduFees = "Enter the course fees";
  }

  if (family === "project") {
    if (inputs.projectCost <= 0) errors.projectCost = "Enter the total project cost";
    else if (inputs.projectContribution >= inputs.projectCost) {
      errors.projectContribution = "Promoter contribution must be less than the project cost";
    }
  }

  if (family === "commercial" && inputs.propertyValue <= 0) {
    errors.propertyValue = "Enter the commercial property's market value";
  }

  if (family === "turnover") {
    if (inputs.turnover <= 0) errors.turnover = "Enter your projected annual turnover";
    const assessment = text(body.wcAssessment);
    if (assessment && (inputs.wcAssessment <= 0 || inputs.wcAssessment > 100)) {
      errors.wcAssessment = "Assessment must be between 1% and 100% of turnover";
    }
  }

  if (family === "gold") {
    if (inputs.goldGrams <= 0) errors.goldGrams = "Enter the gold weight in grams";
    if (inputs.goldRate <= 0) errors.goldRate = "Enter the rate per gram";
  }

  if (family === "wc" && inputs.turnover <= 0) {
    errors.turnover = "Enter your projected annual turnover";
  }

  if (!text(body.creditScore)) errors.creditScore = "Enter your credit score";
  else if (inputs.creditScore < 300 || inputs.creditScore > 900) {
    errors.creditScore = "Credit scores run from 300 to 900";
  }

  if (family === "share" && inputs.shareValue <= 0) {
    errors.shareValue = "Enter the market value of the shares";
  }

  if (!rawDob && !dobParts) {
    errors.dob = "Enter your date of birth";
  } else if (!dateOfBirth) {
    errors.dob = "Enter a valid date of birth (DD/MM/YYYY)";
  } else if (age < 0) {
    errors.dob = "Date of birth cannot be in the future";
  } else if (age < MIN_AGE) {
    errors.dob = "You must be at least 18 years old to apply for a loan";
  } else if (age > MAX_AGE) {
    errors.dob = "Applicants must be 65 years old or younger";
  }

  if (fullName.length < 2) errors.fullName = "Enter your full name";
  if (!MOBILE_REGEX.test(mobile)) errors.mobile = "Enter a valid 10-digit mobile number";
  if (!EMAIL_REGEX.test(email)) errors.email = "Enter a valid email address";
  if (!authorized) errors.authorized = "Please accept the terms to continue";

  if (Object.keys(errors).length > 0) throw badRequest(errors);

  return {
    applicant: { fullName, mobile, email, dateOfBirth, age },
    product,
    legacyCode: legacyCodeFor(product.key),
    inputs,
  };
};

module.exports = { text, resolveProduct, legacyCodeFor, productSlug, normalizeInput };
