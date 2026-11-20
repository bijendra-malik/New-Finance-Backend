const { FranchiseNotificationRead } = require("./franchiseNotification.model");
const { MODELS } = require("../loans/shared/loanModels");
const { FRANCHISE_STATUS } = require("../../constants/roles");

/*
==========================================
Franchise notifications — derived feed + read state

  GET  /api/franchise/notifications?page=1&limit=20
  POST /api/franchise/notifications/read        { keys: [] }
  POST /api/franchise/notifications/read-all

Franchise ko sirf uske apne records dikhte hain:

  - uski khud ki franchise application (pending / approved / rejected)
  - uske franchise customers ke loan applications ka status — har status change
    apni notification hai, isliye "kya hua, kab hua" ka trail rehta hai

Feed alag table me store nahi hoti: source of truth wahi documents hain
(`franchises.franchiseStatus`, loan ka status + `adminUpdates[]`), aur read
state `FranchiseNotificationRead` me per franchise + per key rehti hai. Isliye
API restart ke baad bhi notifications, unread count aur read state same rehte
hain — koi duplicate writer nahi chahiye.

`page`/`limit` se poora feed padha ja sakta hai (max 100 per page). Read-all ek
hi scan me saari unread keys mark karta hai (pehle har page par poora feed
dobara scan hota tha).
==========================================
*/

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_PAGE = 1;
/* Ek request me itni keys hi mark ho sakti hain (payload bound). */
const MAX_KEYS = 500;

const cleanText = (value) => String(value ?? "").trim();

const toInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const safeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : fallback;
};

/* ------------------------- franchise application ------------------------- */

const addApplicationNotification = (franchise, items) => {
  const status = franchise.franchiseStatus || FRANCHISE_STATUS.NONE;
  if (status === FRANCHISE_STATUS.NONE) return;

  let createdAt;
  let title;
  let body;
  let priority = "medium";

  if (status === FRANCHISE_STATUS.PENDING) {
    createdAt = safeDate(franchise.franchiseAppliedAt, franchise.createdAt);
    title = "Franchise application pending";
    body = "Your franchise application is waiting for admin approval.";
  } else if (status === FRANCHISE_STATUS.APPROVED) {
    createdAt = safeDate(franchise.franchiseApprovedAt, franchise.updatedAt);
    title = "Franchise application approved";
    body =
      "Your franchise is approved. Please login using the franchise ID and password shared by the admin.";
    priority = "high";
  } else if (status === FRANCHISE_STATUS.REJECTED) {
    createdAt = safeDate(franchise.franchiseRejectedAt, franchise.updatedAt);
    const reason = cleanText(franchise.businessDetails?.adminNote);
    title = "Franchise application rejected";
    body = reason ? `Reason: ${reason}` : "Please contact support for more details.";
    priority = "high";
  } else {
    return;
  }

  items.push({
    key: `franchise:${franchise._id}:application:${status}:${createdAt.toISOString()}`,
    type: "franchise_application",
    kind: status.toLowerCase(),
    title,
    body,
    priority,
    createdAt: createdAt.toISOString(),
    data: { status },
  });
};

/* ------------------------------ loan status ------------------------------ */

/** Jab loan par status trail na ho — current status kis din ka hai. */
const currentStatusDate = (application) => {
  const status = application.status || "Submitted";
  if (status === "Approved") return safeDate(application.approvedAt, application.updatedAt);
  if (status === "Rejected") return safeDate(application.rejectedAt, application.updatedAt);
  return safeDate(application.updatedAt);
};

/**
 * Ek status change -> ek notification. `at` us change ka waqt hai, isliye
 * purana "Pending" bhi feed me rehta hai jab loan "Approved" ho jaye.
 */
const loanItem = ({ franchise, application, product, status, at, customerName, items }) => {
  const applicationNo = cleanText(application.applicationNo) || String(application._id);
  const label = customerName || applicationNo;
  let title;
  let body;
  let priority = "medium";

  if (status === "Approved") {
    title = `${label} — loan approved`;
    body = `${applicationNo} has been approved.`;
    priority = "high";
  } else if (status === "Rejected") {
    const reason = cleanText(application.adminNote);
    title = `${label} — loan rejected`;
    body = reason
      ? `${applicationNo} was rejected. Reason: ${reason}`
      : `${applicationNo} was rejected.`;
    priority = "high";
  } else if (status === "Pending") {
    title = `${label} — loan under review`;
    body = `${applicationNo} is under review.`;
  } else {
    title = `${label} — application submitted`;
    body = `${applicationNo} was submitted.`;
  }

  items.push({
    key: `franchise:${franchise._id}:loan:${applicationNo}:${status}:${at.toISOString()}`,
    type: "loan_status",
    kind: status.toLowerCase(),
    title,
    body,
    priority,
    createdAt: at.toISOString(),
    data: {
      applicationNo,
      product,
      status,
      customerName: customerName || null,
      franchiseCustomerId: application.franchiseCustomer
        ? String(application.franchiseCustomer)
        : null,
    },
  });
};

const addLoanNotifications = async (franchise, items) => {
  await Promise.all(
    Object.entries(MODELS).map(async ([product, Model]) => {
      const applications = await Model.find({ franchise: franchise._id })
        .select(
          "applicationNo fullName status updatedAt approvedAt rejectedAt adminNote adminUpdates franchiseCustomer"
        )
        .sort({ updatedAt: -1 })
        .lean();

      applications.forEach((application) => {
        /* Personal details schema loan par flat fields ke roop me rehti hai. */
        const customerName = cleanText(application.fullName);

        /*
        Har final decision trail me `kind: "status"` entry hai. Isi se history
        banti hai; trail na ho (purana record / auto-reject) to current status
        hi ek notification banta hai.
        */
        const statusChanges = (application.adminUpdates || [])
          .filter((update) => update.kind === "status" && update.suggestedStatus && update.addedAt)
          .map((update) => ({ status: update.suggestedStatus, at: safeDate(update.addedAt) }))
          .sort((left, right) => left.at - right.at);

        if (statusChanges.length) {
          statusChanges.forEach((change) =>
            loanItem({
              franchise,
              application,
              product,
              status: change.status,
              at: change.at,
              customerName,
              items,
            })
          );

          /* Trail ka last decision aur current status alag ho sakte hain. */
          const status = application.status || "Submitted";
          if (statusChanges[statusChanges.length - 1].status !== status) {
            loanItem({
              franchise,
              application,
              product,
              status,
              at: currentStatusDate(application),
              customerName,
              items,
            });
          }
          return;
        }

        loanItem({
          franchise,
          application,
          product,
          status: application.status || "Submitted",
          at: currentStatusDate(application),
          customerName,
          items,
        });
      });
    })
  );
};

/* ------------------------------- feed builder ------------------------------- */

/** Poora sorted feed + is franchise ki read keys (ek hi scan). */
const buildFeed = async (franchise) => {
  const items = [];
  addApplicationNotification(franchise, items);
  await addLoanNotifications(franchise, items);

  const sorted = items.sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() ||
      String(left.key).localeCompare(String(right.key))
  );

  const receipts = await FranchiseNotificationRead.find({ franchiseId: franchise._id })
    .select("key")
    .lean();
  const readKeys = new Set(receipts.map((row) => row.key));

  return { sorted, readKeys };
};

const listNotifications = async (franchise, query = {}) => {
  const limit = toInt(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = toInt(query.page, DEFAULT_PAGE, 1, Number.MAX_SAFE_INTEGER);

  const { sorted, readKeys } = await buildFeed(franchise);
  const total = sorted.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const paginated = sorted.slice(start, start + limit);

  const notifications = paginated.map((item) => ({
    ...item,
    read: readKeys.has(item.key),
  }));

  return {
    page,
    limit,
    total,
    totalPages,
    unread: sorted.filter((item) => !readKeys.has(item.key)).length,
    notifications,
    generatedAt: new Date().toISOString(),
  };
};

/* ------------------------------ read receipts ------------------------------ */

const normalizeKeys = (keys) =>
  Array.isArray(keys)
    ? [
        ...new Set(
          keys.map((key) => cleanText(key)).filter((key) => key && key.length <= 200)
        ),
      ]
    : [];

const saveReadKeys = async (franchiseId, keys) => {
  if (!keys.length) return 0;
  await FranchiseNotificationRead.bulkWrite(
    keys.map((key) => ({
      updateOne: {
        filter: { franchiseId, key },
        update: { $set: { franchiseId, key, readAt: new Date() } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return keys.length;
};

/** Sirf di gayi keys read mark karo (clicked row). */
const markRead = async (franchise, keys) => {
  const normalized = normalizeKeys(keys).slice(0, MAX_KEYS);

  if (!normalized.length) {
    const feed = await listNotifications(franchise, { limit: 1 });
    return { marked: 0, unread: feed.unread };
  }

  const marked = await saveReadKeys(franchise._id, normalized);
  const feed = await listNotifications(franchise, { limit: 1 });
  return { marked, unread: feed.unread };
};

/** Poora feed read mark karo — ek hi feed scan, phir ek bulk write. */
const markAllRead = async (franchise) => {
  const { sorted, readKeys } = await buildFeed(franchise);
  const unreadKeys = sorted.filter((item) => !readKeys.has(item.key)).map((item) => item.key);
  if (!unreadKeys.length) return { marked: 0, unread: 0 };

  const keys = unreadKeys.slice(0, MAX_KEYS);
  const marked = await saveReadKeys(franchise._id, keys);

  return { marked, unread: Math.max(0, unreadKeys.length - marked) };
};

module.exports = {
  listNotifications,
  markRead,
  markAllRead,
};
