const mongoose = require("mongoose");

const FranchisePlan = require("./franchisePlan.model");

/*
==========================================
Franchise plan service.

Ek hi jagah poora logic — public read aur admin CRUD dono isi ko call karte
hain, isliye frontend aur admin panel kabhi alag-alag jawab nahi dete.

  listPublicPlans()    active plans, UI-ready (derived fields ke saath)
  listAdminPlans()     sab plans (inactive bhi)
  getPlanById()        ek plan
  createPlan()         naya plan
  updatePlan()         plan edit
  setBestValue()       "Best Value" badge pin karna
  setPlanStatus()      activate / deactivate
  removePlan()         soft delete (isActive = false)
  resolveActivePlan()  apply flow ke liye code se plan dhoondhna
  buildPlanSnapshot()  franchise record par immutable price snapshot

Derived fields (kabhi store nahi hote):
  validityLabel           36 -> "3 Years"
  gstAmount               fee * gstPercent / 100
  totalWithGst            fee + gstAmount
  effectiveMonthlyCost    fee / durationMonths   <- "lowest effective monthly cost"
  renewalText             "₹3,900" ya "As applicable"
==========================================
*/

const MONTHS_IN_YEAR = 12;
const DEFAULT_RENEWAL_NOTE = "As applicable";
const DEFAULT_CURRENCY = "INR";
const DEFAULT_GST_PERCENT = 18;
const MAX_FEATURES = 20;
const MAX_FEATURE_LENGTH = 200;

/* ------------------------------------------------------------- errors -- */

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const notFound = (message) => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

const conflict = (message) => {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
};

/* ------------------------------------------------------ pure helpers -- */

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/*
Validity label plan ke `durationMonths` se banta hai — 36 -> "3 Years",
12 -> "1 Year", 6 -> "6 Months". Isse `name` aur validity kabhi mismatch nahi
ho sakte, chahe admin naam kuch bhi likhe.
*/
const durationLabel = (months) => {
  const total = Number(months) || 0;
  if (total <= 0) return "";

  if (total % MONTHS_IN_YEAR === 0) {
    const years = total / MONTHS_IN_YEAR;
    return `${years} Year${years > 1 ? "s" : ""}`;
  }

  return `${total} Month${total > 1 ? "s" : ""}`;
};

const formatINR = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

/* JSON body me kabhi "false" string aati hai — Boolean("false") true deta hai. */
const normalizeBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    return ["true", "1", "yes"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
};

const cleanText = (value) => String(value ?? "").trim();

const normalizeText = (value, label, maxLength = 150) => {
  const text = cleanText(value);
  if (text.length > maxLength) {
    throw badRequest(`${label} is too long (max ${maxLength} characters)`);
  }
  return text;
};

const normalizeCode = (value) => {
  const code = cleanText(value).toUpperCase();
  if (!code) throw badRequest("Plan code is required");
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) {
    throw badRequest(
      "Plan code must be 1-20 characters — letters, numbers, hyphen or underscore only (e.g. 3Y)"
    );
  }
  return code;
};

const normalizeName = (value) => {
  const name = cleanText(value);
  if (!name) throw badRequest("Plan name is required");
  return normalizeText(name, "Plan name", 100);
};

const normalizeNumber = (value, label, { min = 0, max = null, integer = false } = {}) => {
  if (value === undefined || value === null || value === "") {
    throw badRequest(`${label} is required`);
  }

  const number = integer ? Number.parseInt(value, 10) : Number(value);

  if (!Number.isFinite(number)) {
    throw badRequest(`${label} must be a number`);
  }
  if (integer && !Number.isInteger(number)) {
    throw badRequest(`${label} must be a whole number`);
  }
  if (number < min) {
    throw badRequest(`${label} cannot be less than ${min}`);
  }
  if (max !== null && number > max) {
    throw badRequest(`${label} cannot be more than ${max}`);
  }

  return number;
};

const normalizeOptionalNumber = (value, label, options = {}) => {
  if (value === undefined || value === null || value === "") return null;
  return normalizeNumber(value, label, options);
};

const normalizeFeatures = (value) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest("Features must be a list");

  const features = [];
  value.forEach((raw) => {
    const feature = cleanText(raw);
    if (!feature) return;
    if (feature.length > MAX_FEATURE_LENGTH) {
      throw badRequest(`Feature is too long (max ${MAX_FEATURE_LENGTH} characters)`);
    }
    features.push(feature);
  });

  if (features.length > MAX_FEATURES) {
    throw badRequest(`A plan can have at most ${MAX_FEATURES} features`);
  }

  return features;
};

/*
Har plan response me derived fields ke saath jaata hai. Ye ek hi function hai
jo decide karta hai UI ko kya milega — isliye public aur admin response
kabhi drift nahi karte.
*/
const withDerivedFields = (plan) => {
  if (!plan) return null;

  const raw = typeof plan.toObject === "function" ? plan.toObject() : { ...plan };

  const fee = Number(raw.fee) || 0;
  const gstPercent = Number(raw.gstPercent) || 0;
  const durationMonths = Number(raw.durationMonths) || 0;

  const gstAmount = round2((fee * gstPercent) / 100);
  const totalWithGst = round2(fee + gstAmount);

  return {
    ...raw,
    validityLabel: durationLabel(durationMonths),
    gstAmount,
    totalWithGst,
    effectiveMonthlyCost: durationMonths > 0 ? round2(fee / durationMonths) : null,
    effectiveMonthlyWithGst: durationMonths > 0 ? round2(totalWithGst / durationMonths) : null,
    renewalText:
      raw.renewalFee !== null && raw.renewalFee !== undefined
        ? formatINR(raw.renewalFee)
        : raw.renewalNote || DEFAULT_RENEWAL_NOTE,
  };
};

/*
List ka common shape. "Best Value" do tarah se tay hota hai:
  1. admin ne kisi plan par badge pin kiya ho -> wahi
  2. warna sabse kam effective monthly cost wala plan -> automatically
Dusra rule isliye hai taaki badge kabhi gaayab na ho, aur page par likha
"3-year plan carries the lowest effective monthly cost" sach rahe.
*/
const buildPlanView = (plans) => {
  const data = plans.map(withDerivedFields);

  const pinned = data.find((plan) => plan.isBestValue) || null;

  const cheapest = data.reduce((best, plan) => {
    if (plan.effectiveMonthlyCost === null) return best;
    if (!best || plan.effectiveMonthlyCost < best.effectiveMonthlyCost) return plan;
    return best;
  }, null);

  const bestValue = pinned || cheapest;

  return {
    plans: data,
    bestValueCode: bestValue ? bestValue.code : null,
    bestValueIsPinned: Boolean(pinned),
  };
};

const SORT = { sortOrder: 1, createdAt: 1 };

/* ---------------------------------------------------------- read side -- */

/* Frontend (/franchise -> Plans & fees) ke liye — sirf active plans. */
const listPublicPlans = async () => {
  const plans = await FranchisePlan.find({ isActive: true }).sort(SORT);
  return buildPlanView(plans);
};

/* Admin panel ke liye — inactive plans bhi, optional filter ke saath. */
const listAdminPlans = async ({ active } = {}) => {
  const filter = {};

  if (active !== undefined && active !== null && active !== "") {
    filter.isActive = normalizeBoolean(active, true);
  }

  const plans = await FranchisePlan.find(filter).sort(SORT);
  return buildPlanView(plans);
};

const getPlanById = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw notFound("Franchise plan not found");

  const plan = await FranchisePlan.findById(id);
  if (!plan) throw notFound("Franchise plan not found");

  return plan;
};

/* --------------------------------------------------------- write side -- */

const nextSortOrder = async () => {
  const last = await FranchisePlan.findOne().sort({ sortOrder: -1 }).select("sortOrder");
  return last ? Number(last.sortOrder || 0) + 1 : 1;
};

/*
"Best Value" sirf ek plan par rehta hai — naya pin karne se purana hat jaata hai,
warna UI par do badges dikhne lagte.
*/
const pinBestValue = async (planId) => {
  await FranchisePlan.updateMany({ _id: { $ne: planId } }, { $set: { isBestValue: false } });
  await FranchisePlan.updateOne({ _id: planId }, { $set: { isBestValue: true } });
};

const countActivePlans = async (excludeId = null) => {
  const filter = { isActive: true };
  if (excludeId) filter._id = { $ne: excludeId };
  return FranchisePlan.countDocuments(filter);
};

const createPlan = async (payload = {}, adminId = null) => {
  const code = normalizeCode(payload.code);

  const existing = await FranchisePlan.findOne({ code });
  if (existing) throw conflict(`Plan code "${code}" already exists`);

  const plan = await FranchisePlan.create({
    code,
    name: normalizeName(payload.name),
    durationMonths: normalizeNumber(payload.durationMonths, "Duration (months)", {
      min: 1,
      integer: true,
    }),
    fee: normalizeNumber(payload.fee, "Fee", { min: 0 }),
    currency: normalizeText(payload.currency, "Currency", 8) || DEFAULT_CURRENCY,
    gstPercent:
      payload.gstPercent === undefined || payload.gstPercent === null || payload.gstPercent === ""
        ? DEFAULT_GST_PERCENT
        : normalizeNumber(payload.gstPercent, "GST percent", { min: 0, max: 100 }),
    renewalFee: normalizeOptionalNumber(payload.renewalFee, "Renewal fee", { min: 0 }),
    renewalNote:
      normalizeText(payload.renewalNote, "Renewal note", 150) || DEFAULT_RENEWAL_NOTE,
    features: normalizeFeatures(payload.features),
    isActive: normalizeBoolean(payload.isActive, true),
    isBestValue: normalizeBoolean(payload.isBestValue, false),
    sortOrder:
      payload.sortOrder === undefined || payload.sortOrder === null || payload.sortOrder === ""
        ? await nextSortOrder()
        : normalizeNumber(payload.sortOrder, "Sort order", { min: 0, integer: true }),
    createdBy: adminId,
    updatedBy: adminId,
  });

  if (plan.isBestValue) await pinBestValue(plan._id);

  return withDerivedFields(plan);
};

const updatePlan = async (id, payload = {}, adminId = null) => {
  const plan = await getPlanById(id);

  if (payload.code !== undefined) {
    const code = normalizeCode(payload.code);
    if (code !== plan.code) {
      const duplicate = await FranchisePlan.findOne({ code, _id: { $ne: plan._id } });
      if (duplicate) throw conflict(`Plan code "${code}" already exists`);
      plan.code = code;
    }
  }

  if (payload.name !== undefined) plan.name = normalizeName(payload.name);

  if (payload.durationMonths !== undefined) {
    plan.durationMonths = normalizeNumber(payload.durationMonths, "Duration (months)", {
      min: 1,
      integer: true,
    });
  }

  if (payload.fee !== undefined) plan.fee = normalizeNumber(payload.fee, "Fee", { min: 0 });

  if (payload.currency !== undefined) {
    plan.currency = normalizeText(payload.currency, "Currency", 8) || DEFAULT_CURRENCY;
  }

  if (payload.gstPercent !== undefined) {
    plan.gstPercent = normalizeNumber(payload.gstPercent, "GST percent", { min: 0, max: 100 });
  }

  if (payload.renewalFee !== undefined) {
    plan.renewalFee = normalizeOptionalNumber(payload.renewalFee, "Renewal fee", { min: 0 });
  }

  if (payload.renewalNote !== undefined) {
    plan.renewalNote =
      normalizeText(payload.renewalNote, "Renewal note", 150) || DEFAULT_RENEWAL_NOTE;
  }

  if (payload.features !== undefined) plan.features = normalizeFeatures(payload.features);

  if (payload.isActive !== undefined) {
    const isActive = normalizeBoolean(payload.isActive, plan.isActive);
    if (!isActive && (await countActivePlans(plan._id)) === 0) {
      throw badRequest("At least one franchise plan must stay active");
    }
    plan.isActive = isActive;
  }

  if (payload.isBestValue !== undefined) {
    plan.isBestValue = normalizeBoolean(payload.isBestValue, plan.isBestValue);
  }

  if (payload.sortOrder !== undefined) {
    plan.sortOrder = normalizeNumber(payload.sortOrder, "Sort order", { min: 0, integer: true });
  }

  plan.updatedBy = adminId;
  await plan.save();

  if (plan.isBestValue) await pinBestValue(plan._id);

  return withDerivedFields(plan);
};

const setBestValue = async (id, isBestValue = true, adminId = null) => {
  const plan = await getPlanById(id);
  const flag = normalizeBoolean(isBestValue, true);

  plan.isBestValue = flag;
  plan.updatedBy = adminId;
  await plan.save();

  if (flag) await pinBestValue(plan._id);

  return withDerivedFields(plan);
};

const setPlanStatus = async (id, isActive, adminId = null) => {
  const plan = await getPlanById(id);
  const flag = normalizeBoolean(isActive, true);

  if (!flag && (await countActivePlans(plan._id)) === 0) {
    throw badRequest("At least one franchise plan must stay active");
  }

  plan.isActive = flag;
  plan.updatedBy = adminId;
  await plan.save();

  return withDerivedFields(plan);
};

/*
Soft delete. Plan ko DB se hatate nahi — purane franchise records iske code ka
snapshot rakhte hain, aur admin ko baad me history dikhni chahiye. Public list
se bas gayab ho jaata hai.
*/
const removePlan = async (id, adminId = null) => {
  const plan = await getPlanById(id);

  if (!plan.isActive) {
    throw conflict(`Plan "${plan.code}" is already inactive`);
  }

  if ((await countActivePlans(plan._id)) === 0) {
    throw badRequest("At least one franchise plan must stay active");
  }

  plan.isActive = false;
  plan.updatedBy = adminId;
  await plan.save();

  return withDerivedFields(plan);
};

/* ------------------------------------------------- apply flow helpers -- */

/*
Apply karte waqt plan code se plan dhoondhna. Sirf ACTIVE plan chalta hai —
deactivate kiya hua plan naye application me nahi aa sakta.
*/
const resolveActivePlan = async (rawCode) => {
  const code = cleanText(rawCode).toUpperCase();
  if (!code) return null;

  const plan = await FranchisePlan.findOne({ code, isActive: true });

  if (!plan) {
    throw badRequest(
      `Franchise plan "${code}" is not available. Please choose one of the published plans.`
    );
  }

  return plan;
};

/*
Franchise document par jo plan jaata hai wo SNAPSHOT hai — sirf plan id nahi.

Wajah: admin kal kisi plan ka fee badal de to bhi is partner ke record me wahi
price rahegi jo usne apply ke waqt dekhi thi. Sirf ObjectId reference rakhne se
history retroactively badal jaati hai, jo financial record me galat hai.
*/
const buildPlanSnapshot = (plan) => {
  if (!plan) return null;

  const detail = withDerivedFields(plan);

  return {
    plan: detail._id || null,
    code: detail.code,
    name: detail.name,
    durationMonths: detail.durationMonths,
    fee: detail.fee,
    currency: detail.currency,
    gstPercent: detail.gstPercent,
    gstAmount: detail.gstAmount,
    totalWithGst: detail.totalWithGst,
    renewalFee: detail.renewalFee ?? null,
    renewalNote: detail.renewalNote,
    snapshotAt: new Date(),
  };
};

/* ------------------------------------------------------------- seed -- */

/*
Page par jo plans live hain (admin se pehle hardcoded the) — seed script
(scripts/seedFranchisePlans.js) aur tests dono yahi list use karte hain.
*/
const DEFAULT_PLANS = [
  {
    code: "3Y",
    name: "3-Year Plan",
    durationMonths: 36,
    fee: 249000,
    renewalFee: 3900,
    features: ["Franchise access for 3 years"],
    isBestValue: true,
    sortOrder: 1,
  },
  {
    code: "1Y",
    name: "Annual Plan",
    durationMonths: 12,
    fee: 119000,
    renewalFee: null,
    features: ["Franchise access for 1 year"],
    isBestValue: false,
    sortOrder: 2,
  },
  {
    code: "6M",
    name: "6-Month Plan",
    durationMonths: 6,
    fee: 89000,
    renewalFee: null,
    features: ["Franchise access for 6 months"],
    isBestValue: false,
    sortOrder: 3,
  },
  {
    code: "3M",
    name: "Quarterly Plan",
    durationMonths: 3,
    fee: 59000,
    renewalFee: null,
    features: ["Franchise access for 3 months"],
    isBestValue: false,
    sortOrder: 4,
  },
  {
    code: "1M",
    name: "Monthly Plan",
    durationMonths: 1,
    fee: 24000,
    renewalFee: null,
    features: ["Franchise access for 1 month"],
    isBestValue: false,
    sortOrder: 5,
  },
].map((plan) => ({
  ...plan,
  currency: DEFAULT_CURRENCY,
  gstPercent: DEFAULT_GST_PERCENT,
  renewalNote: DEFAULT_RENEWAL_NOTE,
  isActive: true,
}));

module.exports = {
  listPublicPlans,
  listAdminPlans,
  getPlanById,
  createPlan,
  updatePlan,
  setBestValue,
  setPlanStatus,
  removePlan,
  resolveActivePlan,
  buildPlanSnapshot,
  // Pure helpers — tests inhe directly verify karte hain.
  withDerivedFields,
  buildPlanView,
  durationLabel,
  formatINR,
  normalizeBoolean,
  round2,
  DEFAULT_PLANS,
  DEFAULT_GST_PERCENT,
  DEFAULT_RENEWAL_NOTE,
};
