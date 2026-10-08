const mongoose = require("mongoose");
const User = require("../auth/user.model");
const Franchise = require("../franchise/franchise.model");
const { MODELS } = require("../loans/shared/loanStatus");
const { RESOURCE_ROUTES } = require("../loans/shared/adminStatus.service");
const { USER_ROLE } = require("../../constants/roles");

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
    const [totalCustomers, totalFranchises, products, recentRaw] = await Promise.all([
      // Customers = users collection (legacy franchise docs bhi excluded).
      User.countDocuments({ role: { $ne: USER_ROLE.FRANCHISE } }),
      // Franchises apni collection me hain.
      Franchise.countDocuments(),
      Promise.all(
        Object.entries(RESOURCE_ROUTES).map(async ([resource, entry]) => {
          const Model = MODELS[entry.productKey];

          const [total, counts] = await Promise.all([
            Model.countDocuments(),
            Model.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
          ]);

          const byStatus = { Submitted: 0, Pending: 0, Approved: 0, Rejected: 0 };
          counts.forEach((row) => {
            if (byStatus[row._id] !== undefined) byStatus[row._id] = row.count;
          });

          const amounts = await Model.aggregate([
            {
              $group: {
                _id: null,
                requested: { $sum: { $ifNull: ["$loanAmount", 0] } },
                approved: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "Approved"] }, { $ifNull: ["$loanAmount", 0] }, 0],
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
        Object.entries(RESOURCE_ROUTES).map(async ([resource, entry]) => {
          const Model = MODELS[entry.productKey];
          const docs = await Model.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .select("fullName mobile loanType status loanAmount createdAt");
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
          }));
        })
      ),
    ]);

    const recent = recentRaw
      .flat()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

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
        totalFranchises,
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
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { stats };
