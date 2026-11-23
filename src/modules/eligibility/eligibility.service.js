const { EligibilityCheck } = require("./eligibility.model");
const {
  ELIGIBILITY_PRODUCTS,
  findProduct,
  rateCard,
  calculateEligibility,
  ageInYears,
} = require("./eligibility.rules");
const { nextEligibilityCheckNo } = require("../../utils/sequence");

/*
==========================================
Eligibility service

Public website POST /api/eligibility/check yahan aata hai: input validate hota
hai, rules se calculation hoti hai, record save hota hai aur wahi result
wapas jaata hai. Admin panel isi collection ko list/stats se padhta hai.
==========================================
*/

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const text = (value) => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = text(value).replace(/[,₹\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const MAX_PAGE_SIZE = 100;
const DUPLICATE_WINDOW_MS = 60 * 1000;

/* "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY" aur alag DD/MM/YYYY fields. */
const parseDateOfBirth = (body = {}) => {
  const raw = text(body.dateOfBirth ?? body.dob ?? body.dobDate);
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
  /* 31 Feb jaisi invalid date roll over ho jaati hai — usse reject karo. */
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
};

const validateInput = (body = {}) => {
  const name = text(body.name ?? body.fullName);
  const mobile = text(body.mobile ?? body.mobileNumber ?? body.phone);
  const email = text(body.email ?? body.emailAddress).toLowerCase();
  const country = text(body.country);
  const occupation = text(body.occupation);
  const productInput = body.product ?? body.productCode ?? body.loanProduct;
  const product = findProduct(productInput);

  const monthlyIncome = toNumber(body.monthlyIncome ?? body.income);
  const existingEmiRaw = body.existingEmi ?? body.emi ?? 0;
  const existingEmi = toNumber(existingEmiRaw === "" ? 0 : existingEmiRaw);

  const dateOfBirth = parseDateOfBirth(body);

  const errors = [];

  if (name.length < 2) errors.push("Full name is required");
  else if (name.length > 120) errors.push("Full name is too long (max 120 characters)");

  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    errors.push("A valid mobile number is required");
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.push("Enter a valid email address");
  }

  if (!dateOfBirth) errors.push("A valid date of birth is required (DD/MM/YYYY)");

  if (!text(productInput)) errors.push("Select a loan product");
  else if (!product) {
    errors.push(
      `Unknown loan product. Supported: ${ELIGIBILITY_PRODUCTS.map((p) => p.label).join(", ")}`
    );
  }

  if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
    errors.push("A valid monthly income is required");
  }

  if (!Number.isFinite(existingEmi) || existingEmi < 0) {
    errors.push("Existing EMI must be zero or more");
  }

  let age = null;
  if (dateOfBirth) {
    age = ageInYears(dateOfBirth);
    if (age > 120) errors.push("Date of birth looks invalid");
    else if (dateOfBirth.getTime() > Date.now()) errors.push("Date of birth cannot be in the future");
  }

  if (errors.length) throw badRequest(errors.join(", "));

  return {
    name,
    mobile,
    email,
    dateOfBirth,
    country,
    occupation,
    product,
    monthlyIncome,
    existingEmi,
  };
};

/* Ek hi response shape — public result aur admin list. */
const toCheckView = (doc) => {
  const item = typeof doc?.toObject === "function" ? doc.toObject() : { ...doc };

  return {
    id: String(item._id ?? item.id ?? ""),
    checkNo: item.checkNo ?? null,
    name: item.name ?? "",
    mobile: item.mobile ?? "",
    email: item.email ?? "",
    dateOfBirth: item.dateOfBirth ?? null,
    age: item.age ?? null,
    country: item.country ?? "",
    occupation: item.occupation ?? "",
    product: item.productCode ?? "",
    productLabel: item.productLabel ?? "",
    monthlyIncome: item.monthlyIncome ?? 0,
    existingEmi: item.existingEmi ?? 0,
    netIncome: item.netIncome ?? 0,
    foirPercent: item.foirPercent ?? null,
    maxEmi: item.maxEmi ?? 0,
    roi: item.roi ?? null,
    tenureMonths: item.tenureMonths ?? null,
    maxLoanAmount: item.maxLoanAmount ?? null,
    emi: item.emi ?? null,
    eligible: Boolean(item.eligible),
    reason: item.reason ?? null,
    source: item.source ?? "",
    checkedAt: item.createdAt ?? null,
  };
};

/**
 * Naya check: validate -> calculate -> save.
 * Same mobile + product + income 1 minute me dobara aaye to naya row nahi
 * banta (double click / retry), wahi result wapas milta hai.
 */
const createEligibilityCheck = async (body = {}) => {
  const input = validateInput(body);
  const result = calculateEligibility(input);

  const duplicate = await EligibilityCheck.findOne({
    mobile: input.mobile,
    productCode: result.productCode,
    monthlyIncome: input.monthlyIncome,
    createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (duplicate) {
    return { check: toCheckView(duplicate), duplicate: true };
  }

  const created = await EligibilityCheck.create({
    checkNo: await nextEligibilityCheckNo(),
    name: input.name,
    mobile: input.mobile,
    email: input.email,
    dateOfBirth: input.dateOfBirth,
    age: result.age,
    country: input.country,
    occupation: input.occupation,
    productCode: result.productCode,
    productLabel: result.productLabel,
    monthlyIncome: result.monthlyIncome,
    existingEmi: result.existingEmi,
    netIncome: result.netIncome,
    foirPercent: result.foirPercent,
    maxEmi: result.maxEmi,
    roi: result.roi,
    tenureMonths: result.tenureMonths,
    maxLoanAmount: result.maxLoanAmount,
    emi: result.emi,
    eligible: result.eligible,
    reason: result.reason,
    source: text(body.source) || "website-eligibility-calculator",
  });

  return { check: toCheckView(created), duplicate: false };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeEligibleFilter = (value) => {
  const raw = text(value).toLowerCase();
  if (["yes", "true", "eligible", "1"].includes(raw)) return true;
  if (["no", "false", "not-eligible", "not_eligible", "0"].includes(raw)) return false;
  return null;
};

const buildFilter = ({ search, product, eligible, from, to } = {}) => {
  const filter = {};

  const term = text(search);
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    filter.$or = [{ name: rx }, { mobile: rx }, { email: rx }, { checkNo: rx }];
  }

  const wantedProduct = text(product);
  if (wantedProduct && wantedProduct.toLowerCase() !== "all") {
    const match = findProduct(wantedProduct);
    filter.productCode = match ? match.code : wantedProduct;
  }

  const wantedEligible = normalizeEligibleFilter(eligible);
  if (wantedEligible !== null) filter.eligible = wantedEligible;

  const createdAt = {};
  const fromDate = text(from);
  if (fromDate) {
    const parsed = new Date(fromDate);
    if (!Number.isNaN(parsed.getTime())) createdAt.$gte = parsed;
  }
  const toDate = text(to);
  if (toDate) {
    const parsed = new Date(toDate);
    if (!Number.isNaN(parsed.getTime())) {
      /* Date-only input ka poora din cover ho. */
      parsed.setHours(23, 59, 59, 999);
      createdAt.$lte = parsed;
    }
  }
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;

  return filter;
};

const listEligibilityChecks = async (filters = {}) => {
  const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(filters.limit) || 25));
  const safePage = Math.max(1, Number(filters.page) || 1);
  const filter = buildFilter(filters);

  const [docs, total] = await Promise.all([
    EligibilityCheck.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    EligibilityCheck.countDocuments(filter),
  ]);

  return {
    checks: docs.map(toCheckView),
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
  };
};

/* Dashboard ke top cards + product-wise breakdown. */
const eligibilityCheckStats = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [total, eligible, notEligible, today, todayEligible, byProduct, income] =
    await Promise.all([
      EligibilityCheck.countDocuments(),
      EligibilityCheck.countDocuments({ eligible: true }),
      EligibilityCheck.countDocuments({ eligible: false }),
      EligibilityCheck.countDocuments({ createdAt: { $gte: startOfToday } }),
      EligibilityCheck.countDocuments({ eligible: true, createdAt: { $gte: startOfToday } }),
      EligibilityCheck.aggregate([
        {
          $group: {
            _id: "$productCode",
            label: { $first: "$productLabel" },
            total: { $sum: 1 },
            eligible: { $sum: { $cond: ["$eligible", 1, 0] } },
          },
        },
        { $sort: { total: -1 } },
      ]),
      EligibilityCheck.aggregate([
        { $group: { _id: null, avgNetIncome: { $avg: "$netIncome" } } },
      ]),
    ]);

  return {
    total,
    eligible,
    notEligible,
    today,
    todayEligible,
    eligibleRate: total === 0 ? 0 : Number(((eligible / total) * 100).toFixed(1)),
    avgNetIncome: Math.round(income[0]?.avgNetIncome ?? 0),
    byProduct: byProduct.map((row) => ({
      product: row._id,
      label: row.label,
      total: row.total,
      eligible: row.eligible,
    })),
  };
};

module.exports = {
  rateCard,
  createEligibilityCheck,
  listEligibilityChecks,
  eligibilityCheckStats,
};
