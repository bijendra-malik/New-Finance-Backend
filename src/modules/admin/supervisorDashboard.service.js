const { AdminReview } = require("./adminReview.model");
const { listActivity } = require("./adminActivity.service");
const { normalizePermissions } = require("../../constants/adminPermissions");
const {
  adminScope,
  hasModuleAccess,
  MODULE_ACCESS_ALL,
} = require("./adminLoanAccess");

/*
==========================================
Sub-admin dashboard

Sub admin ko loan product charts nahi chahiye — uska kaam supervision hai.
Isliye `GET /dashboard/stats` uske liye `dashboardMode: "supervisor"` deta hai:

  counts        -> needs review / verified / returned / escalated
  pending[]     -> review ke liye pending updates (scope ke andar)
  admins[]      -> kis regular admin par kitna kaam hai
  scope         -> loan products ya modules + granted permissions

Data wahi activity feed se aata hai jo review queue use karti hai, isliye
numbers aur queue hamesha match karte hain.
==========================================
*/

const WINDOW_DAYS = 30;
const MAX_PENDING = 8;

const reviewKeyOf = (row) =>
  [row.entity || "loan", row.applicationId || "", row.id || row.addedAt || ""].join(":");

const stateOf = (record) => {
  const value = String(record?.state ?? "");
  return ["verified", "returned", "escalated", "decided"].includes(value)
    ? value
    : "pending";
};

const modulesFor = (admin) => {
  if (admin?.moduleAccess === MODULE_ACCESS_ALL) return ["customers", "franchises"];
  const modules = [];
  if (hasModuleAccess(admin, "customers")) modules.push("customers");
  if (hasModuleAccess(admin, "franchises")) modules.push("franchises");
  return modules;
};

const toPendingRow = (row, key, record) => ({
  key,
  reviewState: stateOf(record),
  entity: row.entity || "loan",
  applicationId: row.applicationId,
  updateId: row.id,
  slug: row.slug || "",
  label: row.label,
  customerName: row.customerName || "",
  applicationNo: row.applicationNo || null,
  loanStatus: row.loanStatus || "",
  text: row.text || "",
  kind: row.kind || "note",
  suggestedStatus: row.suggestedStatus || null,
  adminId: row.adminId,
  adminName: row.adminName,
  adminRole: row.adminRole,
  addedAt: row.addedAt,
});

const buildSupervisorDashboard = async (admin) => {
  const activity = await listActivity({ days: WINDOW_DAYS, limit: 500 }, admin);

  const keys = activity.updates.map(reviewKeyOf);
  const records = keys.length
    ? await AdminReview.find({ key: { $in: keys } })
        .select("key state note reviewedByName reviewedByRole reviewedAt")
        .lean()
    : [];
  const byKey = new Map(records.map((record) => [record.key, record]));

  const counts = { pending: 0, verified: 0, returned: 0, escalated: 0, decided: 0 };
  const pending = [];

  activity.updates.forEach((row) => {
    const key = reviewKeyOf(row);
    const record = byKey.get(key);
    const state = stateOf(record);
    counts[state] += 1;

    if (state === "pending") {
      pending.push(toPendingRow(row, key, record));
    }
  });

  pending.sort((left, right) =>
    String(right.addedAt).localeCompare(String(left.addedAt))
  );

  const products = activity.products.filter(
    (row) => row.key !== "customers" && row.key !== "franchises"
  );

  return {
    dashboardMode: "supervisor",
    supervisor: {
      scope: adminScope(admin),
      modules: modulesFor(admin),
      products,
      permissions: normalizePermissions(admin?.permissions),
      windowDays: WINDOW_DAYS,
      totalUpdates: activity.updates.length,
      counts,
      pendingTotal: counts.pending,
      pending: pending.slice(0, MAX_PENDING),
      admins: activity.admins,
      lastActivityAt: activity.lastActivityAt,
      generatedAt: new Date().toISOString(),
    },
  };
};

module.exports = { buildSupervisorDashboard, WINDOW_DAYS };
