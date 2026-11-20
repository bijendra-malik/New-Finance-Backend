const mongoose = require("mongoose");

const { NotificationRead, MAX_KEY_LENGTH } = require("./notification.model");
const { AdminReview } = require("./adminReview.model");
const { listActivity } = require("./adminActivity.service");
const { isSuperAdmin, isSubAdmin, hasPermission } = require("./adminLoanAccess");

/*
==========================================
Notifications — derived feed + read state

  GET    /api/admin/notifications
  POST   /api/admin/notifications/read        { keys: [] }
  POST   /api/admin/notifications/read-all
  DELETE /api/admin/notifications/read        (sab unread kar do)

Feed alag se store nahi hoti: admin updates (`/activity`) aur review records
(`/reviews`) hi source of truth hain. Notification sirf un dono ka role-scoped
view hai, isliye koi duplicate writer nahi chahiye aur purana data khud-ba-khud
feed me aa jaata hai. Read state `NotificationRead` me per admin + per key
rehti hai, yaani device badalne par bhi wahi unread count milta hai.

Audience (kaun kya dekhta hai):
  SuperAdmin -> sabki activity + escalated / decided reviews (apna kaam chhod kar)
  SubAdmin   -> apne scope ke admins ki activity (updates.view na ho to sirf status)
                + escalated / decided reviews
  Admin      -> apne scope ke sabhi admins ki activity (status / note / recommendation)
                + apne updates par aaya feedback (verified / returned / escalated / decided)

Notification feed derive hoti hai, isliye koi update gum nahi hota: purane status
changes aur notes restart ke baad bhi feed me aate hain. Read state
(NotificationRead) per admin server par save hoti hai.
==========================================
*/

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Ek request me itni keys hi mark ho sakti hain (payload bound). */
const MAX_KEYS = 200;
/** Activity/review scan ka upper bound — feed se zyada rows padhne ka faayda nahi. */
const MAX_SCAN = 500;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };

const toInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const isObjectId = (value) =>
  typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

const toObjectId = (value) => (isObjectId(value) ? new mongoose.Types.ObjectId(value) : null);

const asIso = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

/**
 * Detail page route — frontend ke notification links jaisa hi rule.
 * Customer list query param se focus karti hai, franchise apna detail page
 * kholta hai, loan `/applications/<slug>/<id>`.
 */
const pathFor = ({ entity, entityId, applicationId, slug }) => {
  const recordId = entityId || applicationId || "";
  if (entity === "customer") {
    return recordId ? `/customers?customer=${encodeURIComponent(recordId)}` : "/customers";
  }
  if (entity === "franchise") {
    return recordId ? `/franchises/${recordId}` : "/franchises";
  }
  if (slug && recordId) return `/applications/${slug}/${recordId}`;
  return "/activity";
};

const entityOf = (value) =>
  value === "customer" || value === "franchise" ? value : "loan";

/* ------------------------------ activity rows ------------------------------ */

/**
 * Ek admin update -> notification. Pure function (koi DB call nahi), isliye
 * test me seedha verify ho sakti hai.
 */
const buildUpdateNotification = (row) => {
  const entity = entityOf(row.entity);
  const actor = row.adminName || "Admin";
  const role = row.adminRole || "Admin";
  const kind = row.kind === "recommendation" || row.kind === "status" ? row.kind : "note";

  let title;
  if (kind === "status") {
    title = row.suggestedStatus
      ? `${actor} changed status to ${row.suggestedStatus}`
      : `${actor} changed the application status`;
  } else if (kind === "recommendation") {
    title = `${actor} recommended ${row.suggestedStatus || "a status change"}`;
  } else {
    title = `${actor} added a note`;
  }

  return {
    key: `update:${row.id}`,
    source: "update",
    kind,
    priority: kind === "status" || kind === "recommendation" ? "high" : "low",
    /* Same priority ke andar recommendation/decision note se upar. */
    rank: kind === "note" ? 3 : 1,
    title,
    body: row.text || "",
    actorName: actor,
    actorRole: role,
    entity,
    entityId: row.entityId || "",
    applicationId: row.applicationId || "",
    applicationNo: row.applicationNo || null,
    productLabel: row.label || "",
    slug: row.slug || "",
    suggestedStatus: row.suggestedStatus || null,
    path: pathFor({ entity, entityId: row.entityId, applicationId: row.applicationId, slug: row.slug }),
    createdAt: asIso(row.addedAt),
  };
};

/* --------------------------------- reviews --------------------------------- */

/*
`rank` same priority ke andar order tay karta hai. Normal admin ke liye "returned"
sabse zaroori hai (kaam wapas aaya hai, wajah ke saath), isliye uska rank sabse
chhota — escalated bhi high hai par returned ke neeche rehta hai.
*/
const REVIEW_COPY = {
  returned: {
    title: "returned your update for correction",
    priority: "high",
    rank: 0,
  },
  escalated: {
    title: "escalated an update for a decision",
    priority: "high",
    rank: 1,
  },
  decided: {
    title: "recorded a decision",
    priority: "normal",
    rank: 2,
  },
  verified: {
    title: "verified your update",
    priority: "low",
    rank: 3,
  },
};

/** Ek review record -> notification (state ke hisaab se copy + priority). */
const buildReviewNotification = (review) => {
  const copy = REVIEW_COPY[review.state] || REVIEW_COPY.verified;
  const actor = review.reviewedByName || "A reviewer";
  const role = review.reviewedByRole || "Sub admin";
  const entity = entityOf(review.entity);

  return {
    key: `review:${review.key}`,
    source: "review",
    kind: review.state,
    priority: copy.priority,
    rank: copy.rank,
    title: `${actor} ${copy.title}`,
    body: review.note || "",
    actorName: actor,
    actorRole: role,
    entity,
    entityId: entity === "loan" ? "" : review.applicationId || "",
    applicationId: review.applicationId || "",
    applicationNo: null,
    productLabel: "",
    slug: review.slug || "",
    suggestedStatus: null,
    path: pathFor({
      entity,
      entityId: entity === "loan" ? "" : review.applicationId,
      applicationId: review.applicationId,
      slug: review.slug,
    }),
    createdAt: asIso(review.reviewedAt),
  };
};

const sortNotifications = (items) =>
  [...items].sort((left, right) => {
    const priority =
      (PRIORITY_ORDER[left.priority] ?? 1) - (PRIORITY_ORDER[right.priority] ?? 1);
    if (priority !== 0) return priority;
    const rank = (left.rank ?? 2) - (right.rank ?? 2);
    if (rank !== 0) return rank;
    return String(right.createdAt).localeCompare(String(left.createdAt));
  });

/* ------------------------------ read receipts ------------------------------ */

const readKeysFor = async (adminId, keys) => {
  if (!keys.length) return new Set();
  const rows = await NotificationRead.find({ adminId, key: { $in: keys } })
    .select("key")
    .lean();
  return new Set(rows.map((row) => row.key));
};

const normalizeKeys = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const keys = [];
  value.forEach((entry) => {
    if (typeof entry !== "string") return;
    const key = entry.trim();
    if (!key || key.length > MAX_KEY_LENGTH || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  });
  return keys;
};

const saveReadKeys = async (adminId, keys) => {
  if (!keys.length) return 0;
  const operations = keys.map((key) => ({
    updateOne: {
      filter: { adminId, key },
      update: { $setOnInsert: { adminId, key, readAt: new Date() } },
      upsert: true,
    },
  }));
  const result = await NotificationRead.bulkWrite(operations, { ordered: false });
  return (result.upsertedCount || 0) + (result.matchedCount || 0);
};

/* ------------------------------- feed builder ------------------------------- */

const reviewsFor = async (viewer, since) => {
  const filter = {};
  if (since) filter.reviewedAt = { $gte: since };

  const viewerId = toObjectId(viewer?.id);

  if (isSuperAdmin(viewer) || isSubAdmin(viewer)) {
    /*
    Super admin ko escalations aur final decisions chahiye — normal admin apne
    update par aaye feedback ka intezaar karta hai.
    */
    filter.state = { $in: ["escalated", "decided"] };
    if (viewerId) filter.reviewedBy = { $ne: viewerId };
  } else {
    /*
    Regular admin ke paas `/activity` ka access hi nahi hai, isliye uska feed
    sirf apne updates par aaye reviews se banta hai.
    */
    if (!viewerId) return [];
    filter.updateAdminId = viewerId;
    filter.state = { $in: ["verified", "returned", "escalated", "decided"] };
    filter.reviewedBy = { $ne: viewerId };
  }

  return AdminReview.find(filter)
    .select(
      "key entity applicationId updateId slug state note reviewedByName reviewedByRole reviewedAt"
    )
    .sort({ reviewedAt: -1 })
    .limit(MAX_SCAN)
    .lean();
};

/**
 * Role-scoped notification list + unread count.
 *
 * Query: days (0 = poori history), limit.
 */
const listNotifications = async (viewer, query = {}) => {
  const days = toInt(query.days, DEFAULT_DAYS, 0, MAX_DAYS);
  const limit = toInt(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const since = days > 0 ? new Date(Date.now() - days * MS_PER_DAY) : null;

  const items = [];
  const viewerIsSuper = isSuperAdmin(viewer);

  /*
  Har admin ko kisi bhi admin ka update notification me milta hai — super admin
  ka status change, regular admin ka note ya recommendation. Scope `listActivity`
  me product access se filter hota hai, isliye ek admin doosre product ka data
  nahi dekhta. Apna hi kaam feed me nahi aata (neeche filter); uske liye reviews
  ka feedback rehta hai.

  Exception: `updates.view` ke bina sub admin ko sirf `kind: "status"` rows
  milti hain, kyunki notes/recommendations padhna us permission ka kaam hai.
  Decision lene wale ko phir bhi pata rehna chahiye ki application par kya hua.
  */
  const subSeesReviewFeed = isSubAdmin(viewer) && hasPermission(viewer, "updates.view");
  const statusOnly = isSubAdmin(viewer) && !subSeesReviewFeed;

  if (viewer?.id) {
    const activity = await listActivity({ days, limit: MAX_SCAN }, viewer);
    const viewerId = viewer?.id ? String(viewer.id) : "";

    activity.updates.forEach((row) => {
      // Apna hi kaam notification nahi banta.
      if (viewerId && row.adminId && row.adminId === viewerId) return;
      if (statusOnly && row.kind !== "status") return;
      const item = buildUpdateNotification(row);
      /*
      Super admin ke liye escalated aur status change high hain — baaki
      informational (low). Normal admin ka status update bell me kho na jaaye,
      isliye `kind: "status"` high rehta hai (actor ka naam/role row me hai).
      */
      if (viewerIsSuper) item.priority = item.kind === "status" ? "high" : "low";
      items.push(item);
    });
  }

  const seesReviews =
    !isSubAdmin(viewer) || subSeesReviewFeed || hasPermission(viewer, "loans.decide");
  const reviews = seesReviews ? await reviewsFor(viewer, since) : [];
  const viewerIsPlainAdmin = !viewerIsSuper && !isSubAdmin(viewer);

  reviews.forEach((review) => {
    const item = buildReviewNotification(review);
    if (viewerIsSuper && item.kind !== "escalated") item.priority = "low";
    /*
    Normal admin ko sirf action tag dikhna chahiye (Verified / Returned /
    Escalated / Decision recorded) — reviewer ka andar ka note nahi.
    */
    if (viewerIsPlainAdmin) item.body = "";
    items.push(item);
  });

  /* Ek hi query: page ke saath-saath unread count bhi isi se nikalta hai. */
  const readKeys = await readKeysFor(viewer.id, items.map((item) => item.key));
  const sorted = sortNotifications(items).slice(0, limit);
  const notifications = sorted.map((item) => ({
    ...item,
    read: readKeys.has(item.key),
  }));

  const unread = items.filter((item) => !readKeys.has(item.key)).length;

  return {
    windowDays: days,
    total: items.length,
    unread,
    notifications,
    generatedAt: new Date().toISOString(),
  };
};

/** Sirf di gayi keys ko read mark karo (clicked row / mark all). */
const markRead = async (viewer, keys) => {
  const normalized = normalizeKeys(keys).slice(0, MAX_KEYS);
  const marked = await saveReadKeys(viewer.id, normalized);
  const feed = await listNotifications(viewer, { days: DEFAULT_DAYS, limit: MAX_LIMIT });
  return { marked, unread: feed.unread };
};

/** Poora current feed read mark karo (read-all button). */
const markAllRead = async (viewer, query = {}) => {
  const feed = await listNotifications(viewer, { ...query, limit: MAX_LIMIT });
  const marked = await saveReadKeys(
    viewer.id,
    feed.notifications.map((item) => item.key).slice(0, MAX_KEYS)
  );
  return { marked, unread: 0 };
};

/** Sab receipts hata do — feed dobara unread ho jaati hai. */
const resetRead = async (viewer) => {
  const result = await NotificationRead.deleteMany({ adminId: viewer.id });
  return { cleared: result.deletedCount || 0 };
};

/* Sirf controller-facing API export hoti hai — baaki helpers file ke andar hi
   rehte hain (pehle ye tests ke liye export the, tests hataaye ja chuke hain). */
module.exports = {
  listNotifications,
  markRead,
  markAllRead,
  resetRead,
};
