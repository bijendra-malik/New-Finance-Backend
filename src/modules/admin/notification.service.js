const mongoose = require("mongoose");

const { NotificationRead, MAX_KEY_LENGTH } = require("./notification.model");
const { AdminReview } = require("./adminReview.model");
const { listActivity } = require("./adminActivity.service");
const { isSuperAdmin, isSubAdmin, hasPermission } = require("./adminLoanAccess");
const Franchise = require("../franchise/franchise.model");
const { FranchiseNotificationRead } = require("../franchise/franchiseNotification.model");
const { FRANCHISE_STATUS } = require("../../constants/roles");
const { MODELS } = require("../loans/shared/loanModels");
const { RESOURCE_ROUTES } = require("../loans/shared/adminStatus.service");

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

/* ------------------------------- franchises ------------------------------- */

/*
Super admin franchise ko manage karta hai (approve / reject), isliye franchise
application ke teen milestones uske feed me aate hain. Sub admin aur regular
admin ka kaam loan products hai — unhe franchise rows nahi milti.
*/
const buildFranchiseNotification = (franchise) => {
  const status = franchise.franchiseStatus;
  const name = franchise.name || "A franchise";
  const id = franchise._id ? String(franchise._id) : "";

  let title;
  let createdAt;
  let priority;
  let body = "";

  if (status === FRANCHISE_STATUS.PENDING) {
    title = `${name} applied for a franchise`;
    createdAt = franchise.franchiseAppliedAt || franchise.createdAt;
    priority = "normal";
  } else if (status === FRANCHISE_STATUS.APPROVED) {
    title = `Franchise ${name} approved`;
    createdAt = franchise.franchiseApprovedAt || franchise.updatedAt;
    priority = "high";
  } else if (status === FRANCHISE_STATUS.REJECTED) {
    title = `Franchise ${name} rejected`;
    createdAt = franchise.franchiseRejectedAt || franchise.updatedAt;
    priority = "high";
    body = franchise.businessDetails?.adminNote || "";
  } else {
    return null;
  }

  return {
    key: `franchise:${id}:${status}:${asIso(createdAt)}`,
    source: "franchise",
    kind: "franchise",
    priority,
    rank: status === FRANCHISE_STATUS.PENDING ? 2 : 1,
    activityType: "franchise_application",
    viewed: false,
    viewedAt: null,
    title,
    body,
    actorName: name,
    /* Franchise admin nahi hai — role chip nahi lagta, sirf naam dikhta hai. */
    actorRole: "",
    entity: "franchise",
    entityId: id,
    applicationId: "",
    applicationNo: franchise.franchiseId || null,
    productLabel: "Franchise",
    slug: "",
    suggestedStatus: null,
    path: id ? `/franchises/${id}` : "/franchises",
    createdAt: asIso(createdAt),
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

  if (viewerIsSuper) {
    const franchises = await Franchise.find({
      franchiseStatus: {
        $in: [FRANCHISE_STATUS.PENDING, FRANCHISE_STATUS.APPROVED, FRANCHISE_STATUS.REJECTED],
      },
    })
      .select(
        "name franchiseId franchiseStatus franchiseAppliedAt franchiseApprovedAt franchiseRejectedAt businessDetails.adminNote createdAt updatedAt"
      )
      .limit(MAX_SCAN)
      .lean();

    /*
    Franchise ne apni application notification padhi ya nahi — read receipts
    (`franchise:<id>:application:<status>:<at>`) se pata chalta hai.
    */
    const receipts = franchises.length
      ? await FranchiseNotificationRead.find({
          franchiseId: { $in: franchises.map((franchise) => franchise._id) },
        })
          .select("franchiseId key readAt")
          .sort({ readAt: -1 })
          .lean()
      : [];

    const viewedAtByKey = new Map();
    receipts.forEach((row) => {
      const status = /^franchise:[^:]+:application:([^:]+):/.exec(String(row.key || ""))?.[1];
      const at = new Date(row.readAt).getTime();
      if (!status || !Number.isFinite(at)) return;
      const key = `${String(row.franchiseId)}:${status}`;
      const current = viewedAtByKey.get(key);
      if (typeof current !== "number" || at > current) viewedAtByKey.set(key, at);
    });

    franchises.forEach((franchise) => {
      const item = buildFranchiseNotification(franchise);
      if (!item) return;
      if (since && new Date(item.createdAt) < since) return;

      const viewedAt = viewedAtByKey.get(`${String(franchise._id)}:${String(franchise.franchiseStatus || "")}`);
      item.viewed = typeof viewedAt === "number";
      item.viewedAt = typeof viewedAt === "number" ? new Date(viewedAt).toISOString() : null;
      items.push(item);
    });
  }

  /*
  Franchise ne kaunsi notification padhi / read-all kiya — ye activity super admin
  ko dikhni chahiye, warna franchise ka kaam review karne ka koi trail nahi.
  Ek hi click se aayi rows 10 second ke bucket me group hoti hain.
  */
  if (viewerIsSuper) {
    const receipts = await FranchiseNotificationRead.find(
      since ? { readAt: { $gte: since } } : {}
    )
      .select("franchiseId key mode readAt")
      .sort({ readAt: -1 })
      .limit(MAX_SCAN)
      .lean();

    const grouped = new Map();
    receipts.forEach((row) => {
      const at = new Date(row.readAt).getTime();
      if (!Number.isFinite(at)) return;
      const mode = row.mode === "read_all" ? "read_all" : "read";
      const bucket = Math.floor(at / 10000);
      const key = `${row.franchiseId}:${mode}:${bucket}`;
      const entry = grouped.get(key);
      if (entry) {
        entry.count += 1;
        entry.at = Math.max(entry.at, at);
        entry.keys.push(row.key);
      } else {
        grouped.set(key, { franchiseId: row.franchiseId, mode, bucket, count: 1, at, keys: [row.key] });
      }
    });

    const ids = [...new Set([...grouped.values()].map((entry) => entry.franchiseId))];
    const directory = new Map();
    if (ids.length) {
      const docs = await Franchise.find({ _id: { $in: ids } })
        .select("name franchiseId")
        .lean();
      docs.forEach((doc) => directory.set(String(doc._id), doc));
    }

    /*
    Read receipts ki keys me customer ka loan bhi hota hai
    (`franchise:<id>:loan:<applicationNo>:...`), isliye super admin ko seedha
    dikhta hai kis customer ke kis loan ka update franchise ne padha.
    */
    const loanNos = [
      ...new Set(
        [...grouped.values()].flatMap((entry) =>
          entry.keys
            .map((key) => /^franchise:[^:]+:loan:([^:]+):/.exec(String(key))?.[1])
            .filter(Boolean)
        )
      ),
    ].slice(0, 30);

    const loanDirectory = new Map();
    if (loanNos.length) {
      await Promise.all(
        Object.entries(MODELS).map(async ([productKey, Model]) => {
          const docs = await Model.find({ applicationNo: { $in: loanNos } })
            .select("applicationNo fullName")
            .lean();
          const label =
            Object.values(RESOURCE_ROUTES).find((route) => route.productKey === productKey)?.label || "";
          docs.forEach((doc) => {
            if (!doc.applicationNo) return;
            loanDirectory.set(doc.applicationNo, { customerName: doc.fullName || "", label });
          });
        })
      );
    }

    grouped.forEach((entry) => {
      const id = String(entry.franchiseId);
      const doc = directory.get(id);
      const name = doc?.name || "A franchise";
      const count = entry.count;
      const createdAt = new Date(entry.at).toISOString();
      const readLoans = [
        ...new Set(
          entry.keys
            .map((key) => /^franchise:[^:]+:loan:([^:]+):/.exec(String(key))?.[1])
            .filter(Boolean)
        ),
      ].slice(0, 3);
      const readDetail = readLoans
        .map((no) => {
          const info = loanDirectory.get(no);
          const who = info?.customerName ? `${info.customerName} · ` : "";
          return `${who}${no}${info?.label ? ` (${info.label})` : ""}`;
        })
        .join(", ");
      items.push({
        key: `franchise-read:${id}:${entry.mode}:${entry.bucket}`,
        source: "franchise",
        kind: "franchise",
        priority: "low",
        rank: 3,
        title:
          entry.mode === "read_all"
            ? `${name} marked all notifications read`
            : `${name} read ${count === 1 ? "a notification" : `${count} notifications`}`,
        body: readDetail ? `${entry.mode === "read_all" ? "Includes: " : ""}${readDetail}` : "",
        activityType: "franchise_read",
        viewed: true,
        viewedAt: createdAt,
        actorName: name,
        actorRole: "",
        entity: "franchise",
        entityId: id,
        applicationId: "",
        applicationNo: doc?.franchiseId || null,
        productLabel: "Franchise",
        slug: "",
        suggestedStatus: null,
        path: id ? `/franchises/${id}` : "/franchises",
        createdAt,
      });
    });
  }

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
