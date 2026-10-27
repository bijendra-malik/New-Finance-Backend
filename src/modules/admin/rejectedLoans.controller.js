/*
==========================================
GET /api/admin/rejected-loans — admin ki "Reject Loans" page.

Har product ke loan collection se wo applications uthata hai jinka
`status === "Rejected"`, newest first:

  - rule-based (auto) rejections — eligibility gate ne final submit par
    reject kiye (company type / salary received as / credit score), inme
    `adminNote` me customer-facing reason aur `autoRejectedAt` hota hai;
  - admin ke khud ke rejections (PATCH /{resource}/:id/status);
  - credit-score rejections (score < 600) jahan koi loan form submit hi nahi
    hua tha — wo alag `creditscorerejections` collection me hoti hain aur yahan
    "Credit Score" product ke roop me dikhti hain (in par View link nahi hota);
  - franchise applications jinhe admin ne reject kiya (`franchiseStatus`
    "Rejected") — ye loan nahi hoti, isliye "Franchise" label ke saath aati hain.

Har row par `channel` hota hai, taaki admin ek nazar me alag kar sake:

  customer            -> customer ne khud apply kiya
  franchise-customer  -> franchise ne apne customer ke naam par file kiya
  franchise           -> franchise ki khud ki application reject hui

Har non-auto row par `rejectedBy` hota hai — kaun se admin ne reject kiya
(`approvedBy` id ka naam), rule-based rows par nahi.

`autoRejectedAt` wale records 30 din baad MongoDB TTL se apne aap delete ho
jaate hain (customer tab tak 30-din cooldown me hai), isliye yahan sirf jo
bachhe hain wo aate hain.
==========================================
*/

const { RESOURCE_ROUTES } = require("../loans/shared/adminStatus.service");
const { MODELS } = require("../loans/shared/loanStatus");
const CreditScoreRejection = require("../customer/creditScoreRejection.model");
const Franchise = require("../franchise/franchise.model");
const Admin = require("./admin.model");

/** Score-only rejections ka label (koi loan product nahi hota). */
const CREDIT_SCORE_LABEL = "Credit Score";

/** Rejected franchise applications ka label + reason. */
const FRANCHISE_LABEL = "Franchise";
const FRANCHISE_REJECTION_REASON = "Franchise application was rejected by admin.";

/** Loan application ka channel — guest/customer ya franchise ke customer. */
const loanChannel = (doc) => (doc.franchise ? "franchise-customer" : "customer");

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
          channel: loanChannel(doc),
        }));
      })
    );

    /*
    Score-only rejections: customer ne credit score to daala par loan form
    submit nahi hua (ya draft expire ho gaya), isliye koi loan document nahi
    bani. Inhe bhi list me dikhate hain, warna admin ko pata hi nahi chalta.
    */
    const scoreRejections = await CreditScoreRejection.find({})
      .sort({ createdAt: -1 })
      .limit(MAX_PER_PRODUCT)
      .lean();

    const scoreRows = scoreRejections.map((doc) => ({
      ...doc,
      resource: null,
      productKey: null,
      productLabel: CREDIT_SCORE_LABEL,
      rejectionReason: doc.reason || "Credit score is below the minimum required.",
      isAutoRejected: true,
      // Score-only rejections sirf direct customers ke hote hain.
      channel: "customer",
    }));

    /* Franchise ki khud ki application admin ne reject ki — loan nahi hai. */
    const rejectedFranchises = await Franchise.find({ franchiseStatus: "Rejected" })
      .sort({ franchiseRejectedAt: -1 })
      .limit(MAX_PER_PRODUCT)
      .select({ name: 1, mobile: 1, email: 1, panNumber: 1, franchiseRejectedAt: 1, createdAt: 1 })
      .lean();

    const franchiseRows = rejectedFranchises.map((doc) => ({
      _id: doc._id,
      resource: null,
      productKey: null,
      productLabel: FRANCHISE_LABEL,
      channel: "franchise",
      fullName: doc.name || "",
      mobile: doc.mobile || "",
      panNumber: doc.panNumber || "",
      rejectionReason: FRANCHISE_REJECTION_REASON,
      isAutoRejected: false,
      rejectedAt: doc.franchiseRejectedAt || null,
      createdAt: doc.createdAt,
    }));

    const loans = [...groups.flat(), ...scoreRows, ...franchiseRows]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, MAX_PER_PRODUCT);

    /*
    Kis admin ne reject kiya — document par `approvedBy` me admin id hoti hai,
    yahan uska naam laga dete hain taaki list me hi pata chale.
    (Rule/score rejections par koi admin nahi hota.)
    */
    const adminIds = [
      ...new Set(
        loans
          .filter((row) => !row.isAutoRejected && row.approvedBy)
          .map((row) => String(row.approvedBy))
      ),
    ];
    const admins = adminIds.length
      ? await Admin.find({ _id: { $in: adminIds } }).select({ name: 1, email: 1 }).lean()
      : [];
    const adminNames = new Map(admins.map((admin) => [String(admin._id), admin.name || admin.email]));

    loans.forEach((row) => {
      if (row.isAutoRejected) return;
      row.rejectedBy = (row.approvedBy && adminNames.get(String(row.approvedBy))) || "Admin";
    });

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
