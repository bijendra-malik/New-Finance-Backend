const router = require("express").Router();

const {
  RESOURCE_ROUTES,
  getListHandler,
  getByIdHandler,
  updateStatusHandler,
  addUpdateHandler,
  deleteApplicationHandler,
} = require("../loans/shared/adminStatus.service");
const dashboardController = require("./dashboard.controller");
const rejectedLoansController = require("./rejectedLoans.controller");
const {
  requireLoanAccess,
  requirePermission,
  isSubAdmin,
  hasPermission,
} = require("./adminLoanAccess");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");

/*
==========================================
One registry drives every product so all resources get the same three
endpoints (see ../loans/shared/adminStatus.service.js).

Write guards:
  status PATCH  -> `loans.decide` (super admin ke paas hamesha, sub admin ko
                   Team & Access se, normal admin ko nahi)
  updates POST  -> normal admin apna note/recommendation likhta hai, sub admin
                   `updates.review` ke saath reviewer remark
  DELETE        -> sirf super admin
==========================================
*/

/**
 * Sub admin review kar sakta hai, record edit nahi — isliye uska comment likhna
 * `updates.review` permission par tika hai. Normal admin ka kaam comment likhna
 * hi hai, isliye usse product access kaafi hai (uske paas permission list khaali
 * hoti hai). Super admin ke liye handler khud saaf 403 deta hai.
 */
const canCommentOnUpdate = (req, res, next) => {
  if (!isSubAdmin(req.admin)) return next();
  if (hasPermission(req.admin, "updates.review")) return next();

  return res.status(403).json({
    success: false,
    message: "You need review permission to comment on applications",
  });
};

Object.keys(RESOURCE_ROUTES).forEach((resource) => {
  const { productKey } = RESOURCE_ROUTES[resource];
  const access = requireLoanAccess(productKey);
  router.get(`/${resource}`, access, getListHandler(resource));
  router.get(`/${resource}/:id`, access, getByIdHandler(resource));
  /*
  Final decision (`loans.decide`) — normal admin sirf note/recommendation deta
  hai, decide nahi karta. Super admin ke paas ye permission hamesha hoti hai,
  sub admin ko Team & Access se milti hai; warna 403.
  */
  router.patch(
    `/${resource}/:id/status`,
    access,
    requirePermission("loans.decide"),
    updateStatusHandler(resource)
  );
  router.post(`/${resource}/:id/updates`, access, canCommentOnUpdate, addUpdateHandler(resource));
  router.patch(`/${resource}/:id/updates`, access, canCommentOnUpdate, addUpdateHandler(resource));
  router.delete(`/${resource}/:id`, access, requireSuperAdmin, deleteApplicationHandler(resource));
});

/* Dashboard stats (replaces the frontend's 15-request fan-out). */
router.get("/dashboard/stats", dashboardController.stats);

/*
Sabhi products ki rejections (rule-based + admin decisions) — admin ki
"Reject Loans" page isse ek call me poora data leti hai.

Super admin sab kuch dekhta hai; restricted admin ko sirf apne assigned
products ki rejections milti hain (controller me filter hota hai). Guard yahan
`requireSuperAdmin` nahi tha sahi — isi wajah se assigned admin ki Reject Loans
page 403 deti thi aur axios interceptor usse sign-out samajh leta tha.
*/
router.get("/rejected-loans", rejectedLoansController.list);

module.exports = router;
