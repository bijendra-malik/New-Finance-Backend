const router = require("express").Router();

const controller = require("../eligibility/eligibility.controller");

/*
==========================================
Admin eligibility-checks routes — mounted at
/api/admin/eligibility-checks (admin auth + super admin guard parent router
src/modules/admin/index.js me lagta hai)

  GET  /        checks list (?search=&product=&eligible=yes|no&from=&to=&page=&limit=)
  GET  /stats   dashboard cards + product-wise breakdown
  GET  /:id     ek check ka pura hisaab

`/:id` sabse last me hai — warna `/stats` wo hi capture kar leta.
==========================================
*/

router.get("/stats", controller.stats);
router.get("/", controller.list);
router.get("/:id", controller.getOne);

module.exports = router;
