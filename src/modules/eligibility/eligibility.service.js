const crypto = require("crypto");
const mongoose = require("mongoose");

const { EligibilityCheck } = require("./eligibility.model");
const { rateCard, calculateEligibility } = require("./eligibility.rules");
const { normalizeInput, resolveProduct, legacyCodeFor, text } = require("./eligibility.input");
const { FOIR_CAP } = require("./engine/core");
const { nextEligibilityCheckNo } = require("../../utils/sequence");

/*
==========================================
Eligibility service

Public POST /api/eligibility/check (ya /calculator/:slug):
  flat form body -> validate -> family engine -> snapshot save -> response.

Admin panel isi collection ko list/stats se padhta hai; purane flat fields
(product, maxLoanAmount, emi, reason...) waise hi rehte hain taaki panel ko
badalna na pade.
==========================================
*/

const MAX_PAGE_SIZE = 100;
const DUPLICATE_WINDOW_MS = 60 * 1000;
const MAX_MESSAGE = 1200;

const clampText = (value, max) => {
  const trimmed = text(value);
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
};

const notFound = (message = "Eligibility check not found") => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

/* Ek hi flat view — public response aur admin list dono isi shape par chalte hain. */
const toCheckView = (doc) => {
  const item = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  const outcome = item.outcome || {};
  const caps = Array.isArray(item.caps)
    ? item.caps.map((cap) => ({ key: cap.key || "", label: cap.label || "", value: cap.value || 0 }))
    : [];

  return {
    id: String(item._id || item.id || ""),
    checkNo: item.checkNo || null,
    name: item.name || "",
    mobile: item.mobile || "",
    email: item.email || "",
    dateOfBirth: item.dateOfBirth || null,
    age: item.age !== undefined && item.age !== null ? item.age : null,
    country: item.country || "",
    occupation: item.occupation || "",

    product: item.productCode || "",
    productKey: item.productKey || "",
    productLabel: item.productLabel || "",
    family: item.family || "",

    monthlyIncome: item.monthlyIncome || 0,
    existingEmi: item.existingEmi || 0,
    creditScore: item.creditScore || 0,
    netIncome: item.netIncome || 0,
    foirPercent: item.foirPercent !== undefined && item.foirPercent !== null ? item.foirPercent : null,
    maxEmi: item.maxEmi || 0,

    roi: item.roi !== undefined && item.roi !== null ? item.roi : null,
    tenureMonths: item.tenureMonths !== undefined && item.tenureMonths !== null ? item.tenureMonths : null,
    maxLoanAmount: item.maxLoanAmount !== undefined && item.maxLoanAmount !== null ? item.maxLoanAmount : null,
    emi: item.emi !== undefined && item.emi !== null ? item.emi : null,
    headline: item.headline || 0,
    headlineLabel: outcome.headlineLabel || "",
    monthly: outcome.monthly || 0,
    monthlyLabel: outcome.monthlyLabel || "",
    binding: item.binding || null,
    caps,

    eligible: Boolean(item.eligible),
    decision: item.eligible ? "eligible" : "not_eligible",
    reason: item.reason || null,
    reasonCode: item.reasonCode || null,
    message: item.message || "",
    suggestions: Array.isArray(outcome.suggestions) ? outcome.suggestions : [],

    source: item.source || "",
    checkedAt: item.createdAt || null,
  };
};

/**
 * Naya check: validate -> calculate -> save.
 * Same applicant + same product + same inputs 1 minute me dobara aaye to naya
 * row nahi banta (double click / retry), wahi result wapas milta hai.
 */
const createEligibilityCheck = async (body = {}, productKey) => {
  const input = normalizeInput(body, productKey);

  const { outcome, eligible, reasonCode, reasonLabel } = calculateEligibility({
    product: input.product,
    inputs: input.inputs,
  });

  const inputHash = crypto
    .createHash("sha1")
    .update(JSON.stringify({ mobile: input.applicant.mobile, product: input.product.key, inputs: input.inputs }))
    .digest("hex");

  const duplicate = await EligibilityCheck.findOne({
    inputHash,
    createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (duplicate) {
    return { check: toCheckView(duplicate), duplicate: true };
  }

  const foirCap = outcome.credit ? outcome.credit.foirCap : null;
  const monthlyCap = outcome.foir ? Math.round(outcome.foir.income * (foirCap || FOIR_CAP)) : 0;

  const created = await EligibilityCheck.create({
    checkNo: await nextEligibilityCheckNo(),

    name: input.applicant.fullName,
    mobile: input.applicant.mobile,
    email: input.applicant.email,
    dateOfBirth: input.applicant.dateOfBirth,
    age: input.applicant.age,
    country: input.applicant.country,
    occupation: input.inputs.occupation,

    productCode: input.legacyCode,
    productKey: input.product.key,
    productLabel: input.product.label,
    family: input.product.family,

    monthlyIncome: input.inputs.monthlyIncome,
    existingEmi: input.inputs.existingEmi,
    creditScore: input.inputs.creditScore,

    netIncome: Math.max(0, input.inputs.monthlyIncome - input.inputs.existingEmi),
    foirPercent: foirCap ? Math.round(foirCap * 1000) / 10 : null,
    maxEmi: monthlyCap,
    roi: outcome.roi || input.product.roi,
    tenureMonths: outcome.months || null,
    maxLoanAmount: eligible ? outcome.headline : null,
    emi: eligible ? outcome.monthly : null,
    headline: outcome.headline || 0,

    eligible,
    reason: eligible ? null : reasonLabel,
    reasonCode,
    message: clampText(outcome.message, MAX_MESSAGE),
    binding: outcome.binding || null,
    caps: outcome.caps || [],

    inputs: input.inputs,
    outcome,
    inputHash,

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
    const match = resolveProduct(wantedProduct);
    filter.productCode = match ? legacyCodeFor(match.key) : wantedProduct;
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

/*
Admin drawer: ek check ka poora record.
Invalid / purani id par bhi 404 milta hai — mongoose ka cast error 500 na bane.
*/
const getEligibilityCheck = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw notFound();

  const doc = await EligibilityCheck.findById(id).lean();
  if (!doc) throw notFound();

  return toCheckView(doc);
};

/* Permanent delete — route already super-admin only hai. */
const deleteEligibilityCheck = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw notFound();

  const removed = await EligibilityCheck.findByIdAndDelete(id).lean();
  if (!removed) throw notFound();

  return toCheckView(removed);
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
  getEligibilityCheck,
  deleteEligibilityCheck,
  listEligibilityChecks,
  eligibilityCheckStats,
};
