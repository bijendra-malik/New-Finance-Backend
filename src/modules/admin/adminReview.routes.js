const router = require("express").Router();

const adminAuth = require("../../middleware/adminAuth.middleware");
const { requirePermission } = require("./adminLoanAccess");
const adminReviewController = require("./adminReview.controller");

/*
==========================================
Sub-admin review queue — /api/admin/reviews

Read ke liye `updates.view`; likhne ki permission action ke hisaab se service
me check hoti hai (Verify -> updates.review, Return -> updates.return,
Escalate -> updates.escalate, Decide -> loans.decide).

Super admin bhi ye routes chala sakta hai (uske paas saari permissions hain) —
uska use case hai sub admins ka review kaam dekhna.
==========================================
*/

router.use(adminAuth);

/*
Apne updates par aaye reviews — har admin ke liye, bina permission ke.
Isliye "/mine" "/" se pehle aur alag path par hai; service khud filter lagati
hai (updateAdminId = signed-in admin).
*/
router.get("/mine", adminReviewController.mine);

router.get("/", requirePermission("updates.view"), adminReviewController.list);

router.get(
  "/summary",
  requirePermission("updates.view"),
  adminReviewController.summary
);

router.post("/", adminReviewController.save);

router.delete(
  "/:key",
  requirePermission("updates.review"),
  adminReviewController.remove
);

module.exports = router;
