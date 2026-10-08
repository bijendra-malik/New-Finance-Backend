const router = require("express").Router();

const controller = require("./franchiseCustomer.controller");

/*
==========================================
Admin franchise-customer routes — mounted at /api/admin/franchise-customers
(admin auth is applied by the parent router in src/modules/admin/index.js)

  GET  /        all franchise customers + CIBIL state
                (?search=&franchise=&cibilStatus=&locked=&page=&limit=)
  GET  /stats   network-wide CIBIL funnel (franchise-wise)
  GET  /:id     one customer: CIBIL + owner franchise + loans status

`/:id` sabse last me hai — warna `/stats` wo hi capture kar leta.
==========================================
*/

router.get("/stats", controller.stats);
router.get("/", controller.list);
router.get("/:id", controller.getOne);

module.exports = router;
