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

/*
==========================================
One registry drives every product so all resources get the same three
endpoints (see ../loans/shared/adminStatus.service.js).
==========================================
*/

Object.keys(RESOURCE_ROUTES).forEach((resource) => {
  router.get(`/${resource}`, getListHandler(resource));
  router.get(`/${resource}/:id`, getByIdHandler(resource));
  router.patch(`/${resource}/:id/status`, updateStatusHandler(resource));
  router.delete(`/${resource}/:id`, deleteApplicationHandler(resource));
});

/* Dashboard stats (replaces the frontend's 15-request fan-out). */
router.get("/dashboard/stats", dashboardController.stats);

/*
Sabhi products ki rejections (rule-based + admin decisions) — admin ki
"Reject Loans" page isse ek call me poora data leti hai.
*/
router.get("/rejected-loans", rejectedLoansController.list);

module.exports = router;
