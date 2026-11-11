const {
  AdminReview,
  REVIEW_STATES,
  REVIEW_ENTITIES,
  MAX_REVIEW_NOTE,
} = require("./adminReview.model");
const { appliesToScope } = require("../../constants/adminPermissions");
const {
  isSuperAdmin,
  hasPermission,
  adminScope,
  hasLoanAccess,
  hasModuleAccess,
} = require("./adminLoanAccess");

/*
==========================================
Sub-admin review service

Har action ek capability se bandha hai:

  verified  -> updates.review
  returned  -> updates.return
  escalated -> updates.escalate
  decided   -> loans.decide  (sirf loan scope)

Rules jo service khud enforce karti hai:
  - permission na ho to 403 (frontend ke button par bharosa nahi),
  - `loans.decide` module scope me nahi chalti,
  - apna hi update review nahi kiya ja sakta,
  - return/escalate/decide ke liye note zaroori,
  - record sirf apne scope ka ho sakta hai.
==========================================
*/

const STATE_PERMISSION = {
  verified: "updates.review",
  returned: "updates.return",
  escalated: "updates.escalate",
  decided: "loans.decide",
};

const NOTE_REQUIRED = new Set(["returned", "escalated", "decided"]);

const MAX_LIMIT = 500;
const DEFAULT_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const fail = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const badRequest = (message) => fail(400, message);
const forbidden = (message) => fail(403, message);

/* ------------------------------ scope helpers ------------------------------ */

const moduleEntitiesFor = (admin) => {
  const entities = [];
  if (hasModuleAccess(admin, "customers")) entities.push("customer");
  if (hasModuleAccess(admin, "franchises")) entities.push("franchise");
  return entities;
};

/**
 * Kis review record tak ye admin pahunch sakta hai. Super admin sab kuch,
 * sub admin sirf apna scope, baaki kuch bhi nahi.
 */
const scopeFilterFor = (admin) => {
  if (isSuperAdmin(admin)) return {};
  if (!admin) return { scopeKey: "none" };

  const scope = adminScope(admin);
  if (scope === "modules") {
    return { scopeKey: "modules", entity: { $in: moduleEntitiesFor(admin) } };
  }
  if (scope === "loans") {
    if (admin.loanAccess === "all") return { scopeKey: "loans" };
    const slugs = Array.isArray(admin.loanAccess) ? admin.loanAccess : [];
    return { scopeKey: "loans", slug: { $in: slugs } };
  }
  return { scopeKey: "none" };
};

const assertTargetInScope = (admin, { scopeKey, entity, slug }) => {
  if (isSuperAdmin(admin)) return;

  if (scopeKey === "loans") {
    if (adminScope(admin) !== "loans") {
      throw forbidden("This loan record is outside your supervision scope");
    }
    if (slug && !hasLoanAccess(admin, slug)) {
      throw forbidden("This loan product is outside your supervision scope");
    }
    return;
  }

  if (adminScope(admin) !== "modules") {
    throw forbidden("This record is outside your supervision scope");
  }
  const allowed = moduleEntitiesFor(admin);
  if (!allowed.includes(entity)) {
    throw forbidden("This record is outside your supervision scope");
  }
};

/* ------------------------------- serialising ------------------------------- */

const toPublic = (doc) => {
  const row = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    key: row.key,
    entity: row.entity,
    applicationId: row.applicationId,
    updateId: row.updateId,
    scopeKey: row.scopeKey,
    slug: row.slug || "",
    state: row.state,
    note: row.note || "",
    updateAdminId: row.updateAdminId ? String(row.updateAdminId) : null,
    updateAdminName: row.updateAdminName || "",
    reviewedBy: row.reviewedBy ? String(row.reviewedBy) : "",
    reviewedByName: row.reviewedByName || "",
    reviewedByRole: row.reviewedByRole || "",
    reviewedAt: row.reviewedAt,
  };
};

const reviewKeyOf = ({ entity, applicationId, updateId }) =>
  `${entity || "loan"}:${applicationId || ""}:${updateId || ""}`;

/* -------------------------------- service --------------------------------- */

const listReviews = async (admin, query = {}) => {
  const state = REVIEW_STATES.includes(String(query.state))
    ? String(query.state)
    : null;
  const parsed = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_LIMIT)
    : MAX_LIMIT;

  const filter = { ...scopeFilterFor(admin) };
  if (state) filter.state = state;

  /*
  `total` poore scope ka count hai, page ka nahi — pehle yahan rows.length
  jaata tha, jisse 500 se zyada records par total galat (limit ke barabar)
  dikhta tha.
  */
  const [rows, total] = await Promise.all([
    AdminReview.find(filter).sort({ reviewedAt: -1 }).limit(limit).lean(),
    AdminReview.countDocuments(filter),
  ]);

  return {
    total,
    reviews: rows.map(toPublic),
  };
};

const saveReview = async (admin, body = {}) => {
  const state = String(body.state ?? "").trim();
  const permission = STATE_PERMISSION[state];
  if (!permission) {
    throw badRequest(
      "Review state must be one of: verified, returned, escalated, decided"
    );
  }
  if (!hasPermission(admin, permission)) {
    throw forbidden(`You do not have the "${permission}" permission`);
  }

  const entity = REVIEW_ENTITIES.includes(String(body.entity))
    ? String(body.entity)
    : "loan";
  const applicationId = String(body.applicationId ?? "").trim();
  const updateId = String(body.updateId ?? body.id ?? "").trim();
  const note = String(body.note ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const scopeKey = entity === "loan" ? "loans" : "modules";

  if (!applicationId) throw badRequest("applicationId is required");
  if (!updateId) throw badRequest("updateId is required");

  if (NOTE_REQUIRED.has(state) && note.length < 5) {
    throw badRequest(
      "Note is required for this action (at least 5 characters)"
    );
  }
  if (note.length > MAX_REVIEW_NOTE) {
    throw badRequest(`Review note is too long (max ${MAX_REVIEW_NOTE} characters)`);
  }

  /* `loans.decide` loan scope ke bahar nahi chalti. */
  if (!isSuperAdmin(admin) && !appliesToScope(permission, scopeKey)) {
    throw forbidden(`The "${permission}" permission does not apply to this scope`);
  }

  assertTargetInScope(admin, { scopeKey, entity, slug });

  const updateAdminId = String(body.updateAdminId ?? "").trim() || null;
  if (updateAdminId && updateAdminId === String(admin?.id ?? "")) {
    throw badRequest("You cannot review your own update");
  }

  const updateAdminName = String(body.updateAdminName ?? "").trim();
  if (
    !isSuperAdmin(admin) &&
    updateAdminName &&
    updateAdminName.toLowerCase() === String(admin?.name ?? "").trim().toLowerCase()
  ) {
    throw badRequest("You cannot review your own update");
  }

  const key = reviewKeyOf({ entity, applicationId, updateId });

  const record = await AdminReview.findOneAndUpdate(
    { key },
    {
      $set: {
        entity,
        applicationId,
        updateId,
        scopeKey,
        slug,
        state,
        note,
        updateAdminId,
        updateAdminName,
        reviewedBy: admin?.id || null,
        reviewedByName:
          admin?.name || admin?.loginId || admin?.email || "Supervisor",
        reviewedByRole: admin?.role || "",
        reviewedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );

  return toPublic(record);
};

const clearReview = async (admin, key) => {
  if (!hasPermission(admin, "updates.review")) {
    throw forbidden('You do not have the "updates.review" permission');
  }

  const filter = { key: String(key ?? "").trim(), ...scopeFilterFor(admin) };
  const record = await AdminReview.findOne(filter);
  if (!record) {
    throw fail(404, "Review not found");
  }

  await record.deleteOne();
  return { key: record.key };
};

const summary = async (admin, query = {}) => {
  const parsed = Number.parseInt(query.days, 10);
  const days = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), 365)
    : DEFAULT_DAYS;
  const since = days > 0 ? new Date(Date.now() - days * MS_PER_DAY) : null;

  const filter = { ...scopeFilterFor(admin) };
  if (since) filter.reviewedAt = { $gte: since };

  const rows = await AdminReview.aggregate([
    { $match: filter },
    { $group: { _id: "$state", count: { $sum: 1 } } },
  ]);

  const counts = { verified: 0, returned: 0, escalated: 0, decided: 0 };
  rows.forEach((row) => {
    if (counts[row._id] !== undefined) counts[row._id] = row.count;
  });

  return {
    windowDays: days,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    counts,
  };
};

module.exports = {
  STATE_PERMISSION,
  reviewKeyOf,
  scopeFilterFor,
  listReviews,
  saveReview,
  clearReview,
  summary,
};
