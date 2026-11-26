const router = require("express").Router();

const controller = require("../eligibility/eligibility.controller");

/*
==========================================
Admin eligibility-checks routes — mounted at
/api/admin/eligibility-checks (admin auth + super admin guard parent router
src/modules/admin/index.js me lagta hai)

  GET    /        checks list (?search=&product=&eligible=yes|no&from=&to=&page=&limit=)
  GET    /stats   dashboard cards + product-wise breakdown
  GET    /:id     ek check ka poora record (drawer)
  DELETE /:id     permanent delete

/:id wale routes /stats ke baad hain, warna "stats" ko bhi id samajh liya
jaata. List rows me hi poora hisaab aata hai, phir bhi drawer GET /:id se
fresh record leta hai taaki delete/update ke baad data purana na dikhe.
==========================================
*/

router.get("/stats", controller.stats);
router.get("/", controller.list);
router.get("/:id", controller.getOne);
router.delete("/:id", controller.remove);

module.exports = router;
