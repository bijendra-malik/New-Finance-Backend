const router = require("express").Router();

const controller = require("../eligibility/eligibility.controller");

/*
==========================================
Admin eligibility-checks routes — mounted at
/api/admin/eligibility-checks (admin auth + super admin guard parent router
src/modules/admin/index.js me lagta hai)

  GET  /        checks list (?search=&product=&eligible=yes|no&from=&to=&page=&limit=)
  GET  /stats   dashboard cards + product-wise breakdown

List rows me hi poora hisaab aata hai (ROI, tenure, max loan, EMI), isliye
admin panel ko alag detail call ki zaroorat nahi hai.
==========================================
*/

router.get("/stats", controller.stats);
router.get("/", controller.list);

module.exports = router;
