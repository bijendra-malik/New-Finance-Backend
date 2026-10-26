/*
==========================================
GET /api/admin/rejected-loans — admin ki "Reject Loans" page.

Har product ke loan collection se wo applications uthata hai jinka
`status === "Rejected"`, newest first:

  - rule-based (auto) rejections — eligibility gate ne final submit par
    reject kiye (company type / salary received as / credit score), inme
    `adminNote` me customer-facing reason aur `autoRejectedAt` hota hai;
  - admin ke khud ke rejections (PATCH /{resource}/:id/status).

`autoRejectedAt` wale records 3 din baad MongoDB TTL se apne aap delete ho
jaate hain (customer tab tak 3-din cooldown me hai), isliye yahan sirf jo
bachhe hain wo aate hain.
==========================================
*/

const { RESOURCE_ROUTES } = require("../loans/shared/adminStatus.service");
const { MODELS } = require("../loans/shared/loanStatus");

/** Per product aur total — dono par cap, list page ke liye kaafi. */
const MAX_PER_PRODUCT = 200;

exports.list = async (req, res, next) => {
  try {
    const groups = await Promise.all(
      Object.entries(RESOURCE_ROUTES).map(async ([resource, entry]) => {
        const Model = MODELS[entry.productKey];
        if (!Model) return [];

        const documents = await Model.find({ status: "Rejected" })
          .sort({ createdAt: -1 })
          .limit(MAX_PER_PRODUCT)
          .lean();

        return documents.map((doc) => ({
          ...doc,
          // Admin route ke liye — detail link bana sake (`/applications/<resource>/<id>`).
          resource,
          productKey: entry.productKey,
          productLabel: entry.label,
          // Reject reason — adminNote hi customer-facing message hai.
          rejectionReason: doc.adminNote || "",
          isAutoRejected: Boolean(doc.autoRejectedAt),
        }));
      })
    );

    const loans = groups
      .flat()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, MAX_PER_PRODUCT);

    res.json({
      success: true,
      total: loans.length,
      autoRejected: loans.filter((loan) => loan.isAutoRejected).length,
      loans,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;
