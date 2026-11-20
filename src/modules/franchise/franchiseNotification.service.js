const { FranchiseNotificationRead } = require("./franchiseNotification.model");
const { MODELS } = require("../loans/shared/loanModels");
const { FRANCHISE_STATUS } = require("../../constants/roles");

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;
const DEFAULT_PAGE = 1;

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

const addApplicationNotification = (franchise, since, items) => {
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
    body = "Your franchise is approved. Please login using the franchise ID and password shared by the admin.";
    priority = "high";
  } else if (status === FRANCHISE_STATUS.REJECTED) {
    createdAt = safeDate(franchise.franchiseRejectedAt, franchise.updatedAt);
    const reason = cleanText(franchise.businessDetails?.adminNote);
    title = "Franchise application rejected";
    body = reason ? `Reason: ${reason}` : "Please contact support for more details.";
    priority = "high";
  }

  if (!createdAt) return;
  if (since && createdAt < since) return;

  items.push({
    key: `franchise:${franchise._id}:application:${status}:${createdAt.toISOString()}`,
    type: "franchise_application",
    kind: status.toLowerCase(),
    title,
    body,
    priority,
    createdAt: createdAt.toISOString(),
  });
};

const addLoanNotifications = async (franchise, since, items) => {
  await Promise.all(
    Object.entries(MODELS).map(async ([product, Model]) => {
      const filter = { franchise: franchise._id };
      if (since) filter.updatedAt = { $gte: since };

      const applications = await Model.find(filter)
        .select("applicationNo status updatedAt approvedAt rejectedAt adminNote franchiseCustomer personalDetails")
        .sort({ updatedAt: -1 })
        .lean();

      applications.forEach((application) => {
        const status = application.status || "Submitted";
        const statusDate =
          status === "Approved"
            ? safeDate(application.approvedAt, application.updatedAt)
            : status === "Rejected"
              ? safeDate(application.rejectedAt, application.updatedAt)
              : safeDate(application.updatedAt);

        if (since && statusDate < since) return;

        const applicationNo = cleanText(application.applicationNo) || String(application._id);
        let title = "Loan application updated";
        let body = `${applicationNo} is ${status.toLowerCase()}.`;

        if (status === "Approved") title = "Loan application approved";
        else if (status === "Rejected") {
          title = "Loan application rejected";
          body = application.adminNote
            ? `${applicationNo} rejected. Reason: ${cleanText(application.adminNote)}`
            : `${applicationNo} was rejected.`;
        } else if (status === "Pending") title = "Loan application under review";
        else title = "Loan application submitted";

        items.push({
          key: `franchise:${franchise._id}:loan:${applicationNo}:${status}:${statusDate.toISOString()}`,
          type: "loan_status",
          kind: status.toLowerCase(),
          title,
          body,
          priority: status === "Approved" || status === "Rejected" ? "high" : "medium",
          createdAt: statusDate.toISOString(),
          data: {
            applicationNo,
            product,
            franchiseCustomerId: application.franchiseCustomer ? String(application.franchiseCustomer) : null,
            status,
          },
        });
      });
    })
  );
};

const listNotifications = async (franchise, query = {}) => {
  const limit = toInt(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = toInt(query.page, DEFAULT_PAGE, 1, Number.MAX_SAFE_INTEGER);

  const items = [];
  addApplicationNotification(franchise, null, items);
  await addLoanNotifications(franchise, null, items);

  const sorted = items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const total = sorted.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const paginated = sorted.slice(start, start + limit);

  const allKeys = items.map((item) => item.key);
  const receipts = allKeys.length
    ? await FranchiseNotificationRead.find({
        franchiseId: franchise._id,
        key: { $in: allKeys },
      }).select("key").lean()
    : [];
  const readKeys = new Set(receipts.map((row) => row.key));

  const notifications = paginated.map((item) => ({
    ...item,
    read: readKeys.has(item.key),
  }));

  const unread = items.filter((item) => !readKeys.has(item.key)).length;

  return {
    page,
    limit,
    total,
    totalPages,
    unread,
    notifications,
    generatedAt: new Date().toISOString(),
  };
};

const normalizeKeys = (keys) =>
  Array.isArray(keys)
    ? [...new Set(keys.map((key) => cleanText(key)).filter((key) => key && key.length <= 200))]
    : [];

const markRead = async (franchise, keys) => {
  const normalized = normalizeKeys(keys).slice(0, 100);
  if (!normalized.length) return { marked: 0, unread: (await listNotifications(franchise)).unread };

  await FranchiseNotificationRead.bulkWrite(
    normalized.map((key) => ({
      updateOne: {
        filter: { franchiseId: franchise._id, key },
        update: { $set: { franchiseId: franchise._id, key, readAt: new Date() } },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  const feed = await listNotifications(franchise);
  return { marked: normalized.length, unread: feed.unread };
};

const markAllRead = async (franchise, query = {}) => {
  const first = await listNotifications(franchise, {
    ...query,
    page: 1,
    limit: MAX_LIMIT,
  });
  const keys = [...first.notifications.map((item) => item.key)];

  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await listNotifications(franchise, {
      ...query,
      page,
      limit: MAX_LIMIT,
    });
    keys.push(...next.notifications.map((item) => item.key));
  }

  if (!keys.length) return { marked: 0, unread: 0 };

  await FranchiseNotificationRead.bulkWrite(
    [...new Set(keys)].map((key) => ({
      updateOne: {
        filter: { franchiseId: franchise._id, key },
        update: { $set: { franchiseId: franchise._id, key, readAt: new Date() } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return { marked: new Set(keys).size, unread: 0 };
};

module.exports = {
  listNotifications,
  markRead,
  markAllRead,
};
