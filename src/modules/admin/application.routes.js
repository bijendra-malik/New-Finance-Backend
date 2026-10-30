const router = require("express").Router();

const {
  RESOURCE_ROUTES,
  getListHandler,
  getByIdHandler,
  updateStatusHandler,
  deleteApplicationHandler,
} = require("../loans/shared/adminStatus.service");
const dashboardController = require("./dashboard.controller");
const rejectedLoansController = require("./rejectedLoans.controller");
const { requireLoanAccess } = require("./adminLoanAccess");

/*
==========================================
One registry drives every product so all resources get the same three
endpoints (see ../loans/shared/adminStatus.service.js).
==========================================
*/

Object.keys(RESOURCE_ROUTES).forEach((resource) => {
  const { productKey } = RESOURCE_ROUTES[resource];
  const access = requireLoanAccess(productKey);
  router.get(`/${resource}`, access, getListHandler(resource));
  router.get(`/${resource}/:id`, access, getByIdHandler(resource));
  router.patch(`/${resource}/:id/status`, access, updateStatusHandler(resource));
  router.delete(`/${resource}/:id`, access, deleteApplicationHandler(resource));
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
