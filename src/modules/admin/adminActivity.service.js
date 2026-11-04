const Admin = require("./admin.model");
const { MODELS } = require("../loans/shared/loanStatus");
const { RESOURCE_ROUTES } = require("../loans/shared/adminStatus.service");
const { PRODUCT_ACCESS_SLUGS } = require("./adminLoanAccess");

/*
==========================================
Admin activity (super admin reporting)
  GET /api/admin/activity

Regular admins already leave a trail on every application they touch:
`adminUpdates[]` carries the note / suggested decision / final status change,
the admin who wrote it (addedBy) and when (addedAt). This service reads that
trail across all 18 loan collections and reshapes it into ONE organisation-wide
feed:

  update -> { admin, product, application, applicant, text, kind, addedAt }

So the super admin can answer "kis admin ne kis loan par kya update kiya"
without opening each application:

  filters : one admin · one product · a day window
  counts  : per admin + per product, always computed BEFORE the admin filter
            (the left rail needs every admin's total, not just the selection)
==========================================
*/

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_DOCS_PER_PRODUCT = 300;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PRODUCTS = Object.entries(RESOURCE_ROUTES).map(([resource, entry]) => ({
  resource,
  productKey: entry.productKey,
  slug: PRODUCT_ACCESS_SLUGS[entry.productKey] || entry.productKey,
  label: entry.label,
}));

const toInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const isObjectId = (value) =>
  typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

/** Product filter accepts the product key, its access slug or its resource path. */
const resolveProduct = (value) => {
  const needle = String(value ?? "").trim();
  if (!needle) return null;
  return (
    PRODUCTS.find(
      (product) =>
        product.productKey === needle ||
        product.slug === needle ||
        product.resource === needle
    ) ?? null
  );
};

const resolveKind = (kind) =>
  kind === "recommendation" || kind === "status" ? kind : "note";

const mapUpdate = (product, doc, update) => {
  const addedAt = update.addedAt ? new Date(update.addedAt) : null;
  const addedAtMs = addedAt && !Number.isNaN(addedAt.getTime()) ? addedAt.getTime() : 0;

  return {
    id: `${doc._id}-${update._id ?? addedAtMs ?? 0}`,
    applicationId: String(doc._id),
    productKey: product.productKey,
    slug: product.slug,
    label: product.label,
    customerName: doc.fullName || "",
    mobile: doc.mobile || "",
    applicationNo: doc.applicationNo || null,
    loanStatus: doc.status || "Submitted",
    loanAmount: typeof doc.loanAmount === "number" ? doc.loanAmount : null,
    text: update.text || "",
    kind: resolveKind(update.kind),
    suggestedStatus: update.suggestedStatus || null,
    adminId: update.addedBy ? String(update.addedBy) : null,
    adminName: update.addedByName || "Admin",
    adminRole: update.addedByRole || "",
    addedAt: addedAtMs ? addedAt.toISOString() : "",
    addedAtMs,
  };
};

/** One product's trail, newest first, already normalised. */
const collectProductUpdates = async (product, since) => {
  const Model = MODELS[product.productKey];
  if (!Model) return [];

  const filter = { "adminUpdates.0": { $exists: true } };
  if (since) filter["adminUpdates.addedAt"] = { $gte: since };

  const docs = await Model.find(filter)
    .select("fullName mobile applicationNo status loanAmount adminUpdates")
    .sort({ "adminUpdates.addedAt": -1 })
    .limit(MAX_DOCS_PER_PRODUCT);

  const sinceMs = since ? since.getTime() : 0;

  return docs
    .flatMap((doc) =>
      (doc.adminUpdates || [])
        .map((update) => mapUpdate(product, doc, update))
        .filter((row) => !sinceMs || row.addedAtMs >= sinceMs)
    )
    /*
    Super Admin loan par message nahi karta (API bhi block karta hai). Purane
    notes feed se hata diye jaate hain; final decision (kind: "status") audit
    trail ke liye bana rehta hai.
    */
    .filter((row) => !(row.adminRole === "SuperAdmin" && row.kind !== "status"));
};

const listActivity = async (query = {}) => {
  const days = toInt(query.days, DEFAULT_DAYS, 0, MAX_DAYS);
  const limit = toInt(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const since = days > 0 ? new Date(Date.now() - days * MS_PER_DAY) : null;

  const adminId = isObjectId(query.adminId) ? String(query.adminId) : null;
  const product = resolveProduct(query.product);

  // All products are read on purpose: the per-product counts must not collapse
  // when one product is selected. The selection only narrows the visible list.
  const batches = await Promise.all(
    PRODUCTS.map((entry) => collectProductUpdates(entry, since))
  );

  const all = batches.flat().sort((left, right) => right.addedAtMs - left.addedAtMs);

  const adminTotals = new Map();
  const adminNames = new Map();
  const productTotals = new Map();

  all.forEach((row) => {
    const key = row.adminId || `name:${row.adminName}`;
    adminTotals.set(key, (adminTotals.get(key) || 0) + 1);
    if (!adminNames.has(key)) {
      adminNames.set(key, { name: row.adminName, role: row.adminRole });
    }
    productTotals.set(row.productKey, (productTotals.get(row.productKey) || 0) + 1);
  });

  const adminDocs = await Admin.find().select("name email loginId role").lean();
  const admins = adminDocs.map((doc) => {
    const id = String(doc._id);
    return {
      id,
      name: doc.name || doc.loginId || doc.email || "Admin",
      email: doc.email || "",
      loginId: doc.loginId || "",
      role: doc.role || "Admin",
      total: adminTotals.get(id) || 0,
    };
  });

  // Admins removed from the team still appear, so their history is not lost.
  adminNames.forEach((info, key) => {
    if (admins.some((admin) => admin.id === key)) return;
    admins.push({
      id: key,
      name: info.name,
      email: "",
      loginId: "",
      role: info.role || "Admin",
      total: adminTotals.get(key) || 0,
    });
  });

  admins.sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));

  const visible = all.filter(
    (row) =>
      (!adminId || row.adminId === adminId) &&
      (!product || row.productKey === product.productKey)
  );

  return {
    windowDays: days,
    total: visible.length,
    lastActivityAt: all[0]?.addedAt || null,
    updates: visible.slice(0, limit).map(({ addedAtMs, ...row }) => row),
    admins,
    products: PRODUCTS.map((entry) => ({
      key: entry.productKey,
      slug: entry.slug,
      label: entry.label,
      total: productTotals.get(entry.productKey) || 0,
    })),
  };
};

module.exports = { PRODUCTS, listActivity };
