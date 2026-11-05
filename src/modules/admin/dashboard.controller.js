const User = require("../auth/user.model");
const Franchise = require("../franchise/franchise.model");
const { MODELS } = require("../loans/shared/loanStatus");
const { RESOURCE_ROUTES } = require("../loans/shared/adminStatus.service");
const { USER_ROLE } = require("../../constants/roles");
const {
  hasModuleAccess,
  hasProductAccess,
  isSuperAdmin,
  visibleLoanFilter,
} = require("./adminLoanAccess");
const { ENTITY_PRODUCTS, collectEntityUpdates } = require("./adminActivity.service");
const { collectPendingDecisions } = require("./adminUpdate.service");

/*
==========================================
GET /api/admin/dashboard/stats

One aggregate over every loan collection + the customers collection, so the
admin dashboard needs one request instead of a 15-request fan-out.
==========================================
*/

const ROUND = 2;

const stats = async (req, res, next) => {
  try {
    const canViewLoanDashboard =
      isSuperAdmin(req.admin) ||
      Object.values(RESOURCE_ROUTES).some((entry) =>
        hasProductAccess(req.admin, entry.productKey)
      );
    if (!canViewLoanDashboard) {
      const canViewCustomers = hasModuleAccess(req.admin, "customers");
      const canViewFranchises = hasModuleAccess(req.admin, "franchises");
      if (!canViewCustomers && !canViewFranchises) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to access this dashboard",
        });
      }

      const dashboardMode = canViewCustomers && canViewFranchises
        ? "accounts"
        : canViewFranchises
          ? "franchises"
          : "customers";

      const [customerStats, franchiseStats] = await Promise.all([
        canViewCustomers
          ? Promise.all([
              User.countDocuments({ role: { $ne: USER_ROLE.FRANCHISE } }),
              User.countDocuments({ role: { $ne: USER_ROLE.FRANCHISE }, isActive: true }),
              User.countDocuments({ role: { $ne: USER_ROLE.FRANCHISE }, isActive: false }),
              User.countDocuments({ role: { $ne: USER_ROLE.FRANCHISE }, isVerified: true }),
              User.find({ role: { $ne: USER_ROLE.FRANCHISE } })
                .sort({ createdAt: -1 })
                .limit(8)
                .select("customerId name email mobile city state country isVerified isActive createdAt"),
            ]).then(([totalCustomers, activeCustomers, inactiveCustomers, verifiedCustomers, recentCustomers]) => ({
              totalCustomers,
              activeCustomers,
              inactiveCustomers,
              verifiedCustomers,
              recentCustomers,
            }))
          : Promise.resolve(null),
        canViewFranchises
          ? Promise.all([
              Franchise.countDocuments(),
              Franchise.countDocuments({ franchiseStatus: "Pending" }),
              Franchise.countDocuments({ franchiseStatus: "Approved" }),
              Franchise.countDocuments({ franchiseStatus: "Rejected" }),
              Franchise.countDocuments({
                $or: [
                  { franchiseStatus: "None" },
                  { franchiseStatus: { $exists: false } },
                  { franchiseStatus: "" },
                ],
              }),
              Franchise.countDocuments({ isActive: true }),
              Franchise.find()
                .sort({ createdAt: -1 })
                .limit(8)
                .select("franchiseId name fullName businessName contactPerson email mobile city state country franchiseStatus isVerified isActive createdAt"),
            ]).then(([
              totalFranchises,
              pendingFranchises,
              approvedFranchises,
              rejectedFranchises,
              registeredFranchises,
              activeFranchises,
              recentFranchises,
            ]) => ({
              totalFranchises,
              pendingFranchises,
              approvedFranchises,
              rejectedFranchises,
              registeredFranchises,
              activeFranchises,
              recentFranchises,
            }))
          : Promise.resolve(null),
      ]);

      return res.json({
        success: true,
        stats: {
          dashboardMode,
          ...(customerStats ?? {}),
          ...(franchiseStats ?? {}),
          generatedAt: new Date().toISOString(),
        },
      });
    }

    const [totalCustomers, totalFranchises, products, recentRaw] = await Promise.all([
      // Customers = users collection (legacy franchise docs bhi excluded).
      User.countDocuments({ role: { $ne: USER_ROLE.FRANCHISE } }),
      // Franchise totals are only included in the Super Admin dashboard.
      isSuperAdmin(req.admin) ? Franchise.countDocuments() : Promise.resolve(null),
      Promise.all(
        Object.entries(RESOURCE_ROUTES)
          .filter(([, entry]) => hasProductAccess(req.admin, entry.productKey))
          .map(async ([resource, entry]) => {
            const Model = MODELS[entry.productKey];
            const filter = visibleLoanFilter(req.admin);

            const [total, counts] = await Promise.all([
              Model.countDocuments(filter),
              Model.aggregate([
                { $match: filter },
                { $group: { _id: "$status", count: { $sum: 1 } } },
              ]),
            ]);

            const byStatus = { Submitted: 0, Pending: 0, Approved: 0, Rejected: 0 };
            counts.forEach((row) => {
              if (byStatus[row._id] !== undefined) byStatus[row._id] = row.count;
            });

            const amounts = await Model.aggregate([
              { $match: filter },
              {
                $group: {
                  _id: null,
                  requested: { $sum: { $ifNull: ["$loanAmount", 0] } },
                  approved: {
                    $sum: {
                      $cond: [
                        { $eq: ["$status", "Approved"] },
                        { $ifNull: ["$loanAmount", 0] },
                        0,
                      ],
                    },
                  },
                },
              },
            ]);

            return {
              resource,
              label: entry.label,
              total,
              ...byStatus,
              requestedAmount: amounts[0]?.requested ?? 0,
              approvedAmount: amounts[0]?.approved ?? 0,
            };
          })
      ),
      // Recent applications across ALL products, newest first (top 10).
      Promise.all(
        Object.entries(RESOURCE_ROUTES)
          .filter(([, entry]) => hasProductAccess(req.admin, entry.productKey))
          .map(async ([resource, entry]) => {
            const Model = MODELS[entry.productKey];
            const docs = await Model.find(visibleLoanFilter(req.admin))
              .sort({ createdAt: -1 })
              .limit(10)
              .select("fullName mobile loanType status loanAmount createdAt adminUpdates");
            return docs.map((doc) => ({
              _id: doc._id,
              resource,
              product: entry.label,
              applicantName: doc.fullName || "",
              mobile: doc.mobile || "",
              loanType: doc.loanType || entry.label,
              status: doc.status || "Submitted",
              loanAmount: doc.loanAmount ?? null,
              createdAt: doc.createdAt,
              adminUpdatesCount: Array.isArray(doc.adminUpdates) ? doc.adminUpdates.length : 0,
              lastUpdateAt: Array.isArray(doc.adminUpdates) && doc.adminUpdates.length
                ? doc.adminUpdates[doc.adminUpdates.length - 1]?.addedAt || doc.adminUpdates[0]?.addedAt
                : null,
            }));
          })
      ),
    ]);

    const recent = recentRaw
      .flat()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    /*
    Admin activity feed — every note, status recommendation and final status
    change across the products this admin can see. The super admin sees the
    whole organisation here instead of opening each application.
    */
    const updatesRaw = await Promise.all(
      Object.entries(RESOURCE_ROUTES)
        .filter(([, entry]) => hasProductAccess(req.admin, entry.productKey))
        .map(async ([resource, entry]) => {
          const Model = MODELS[entry.productKey];
          const docs = await Model.find({
            ...visibleLoanFilter(req.admin),
            "adminUpdates.0": { $exists: true },
          })
            .sort({ "adminUpdates.addedAt": -1 })
            .limit(10)
            .select("fullName applicationNo loanType status loanAmount adminUpdates");

          return docs.flatMap((doc) =>
            (doc.adminUpdates || []).map((update) => ({
              _id: `${doc._id}-${update._id}`,
              applicationId: doc._id,
              resource,
              product: entry.label,
              applicantName: doc.fullName || "",
              applicationNo: doc.applicationNo || null,
              loanStatus: doc.status || "Submitted",
              loanAmount: doc.loanAmount ?? null,
              text: update.text || "",
              kind: update.kind || "note",
              suggestedStatus: update.suggestedStatus || null,
              addedByName: update.addedByName || "Admin",
              addedByRole: update.addedByRole || "",
              addedAt: update.addedAt,
            }))
          );
        })
    );

    /*
    Customers aur franchises bhi regular admins ke kaam ka hissa hain — unke
    trail bhi isi panel me aate hain, taaki super admin ek jagah sab dekhe.
    */
    const ENTITY_WINDOW_DAYS = 30;
    const entitySince = new Date(
      Date.now() - ENTITY_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    const entityBatches = await Promise.all(
      ENTITY_PRODUCTS.map((product) => collectEntityUpdates(product, entitySince))
    );

    /*
    Entity rows ko dashboard row shape me map karte hain — frontend ek hi
    `toAdminActivity` se sab rows padhta hai (`product`, `applicantName`).
    */
    const entityRows = entityBatches.flat().map((row) => ({
      _id: row.id,
      applicationId: row.entityId,
      entity: row.entity,
      entityId: row.entityId,
      resource: row.productKey,
      product: row.label,
      applicantName: row.customerName,
      applicationNo: row.applicationNo,
      loanStatus: row.loanStatus,
      loanAmount: null,
      text: row.text,
      tag: row.tag,
      kind: row.kind,
      suggestedStatus: row.suggestedStatus,
      addedByName: row.adminName,
      addedByRole: row.adminRole,
      addedAt: row.addedAt,
    }));

    const recentUpdates = [...updatesRaw.flat(), ...entityRows]
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
      .slice(0, 25);

    /* Super admin ko seedha dikhe: kis record ka final decision pending hai. */
    const pendingDecisions = isSuperAdmin(req.admin)
      ? await collectPendingDecisions()
      : null;

    const totals = products.reduce(
      (acc, product) => {
        acc.totalApplications += product.total;
        acc.submitted += product.Submitted;
        acc.pending += product.Pending;
        acc.approved += product.Approved;
        acc.rejected += product.Rejected;
        acc.requestedAmount += product.requestedAmount;
        acc.approvedAmount += product.approvedAmount;
        return acc;
      },
      { totalApplications: 0, submitted: 0, pending: 0, approved: 0, rejected: 0, requestedAmount: 0, approvedAmount: 0 }
    );

    const decided = totals.approved + totals.rejected;
    const approvalRate = decided === 0 ? 0 : Number(((totals.approved / decided) * 100).toFixed(ROUND));

    res.json({
      success: true,
      stats: {
        totalCustomers,
        ...(isSuperAdmin(req.admin) ? { totalFranchises } : {}),
        totalApplications: totals.totalApplications,
        submitted: totals.submitted,
        pending: totals.pending,
        approved: totals.approved,
        rejected: totals.rejected,
        requestedAmount: totals.requestedAmount,
        approvedAmount: totals.approvedAmount,
        approvalRate,
        products,
        recent,
        recentUpdates,
        ...(pendingDecisions ? { pendingDecisions } : {}),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { stats };
