const router = require("express").Router();

const controller = require("./franchiseCustomer.controller");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");

/*
==========================================
Admin franchise-customer routes — mounted at /api/admin/franchise-customers
(admin auth is applied by the parent router in src/modules/admin/index.js)

  GET  /        all franchise customers
                (?search=&franchise=&page=&limit=)
  GET  /stats   network-wide customer count (franchise-wise)
  GET  /:id     one customer: details + owner franchise + loans status
  DELETE /:id   remove the customer + CIBIL audit trail (super admin only)

`/:id` sabse last me hai — warna `/stats` wo hi capture kar leta.
==========================================
*/

router.get("/stats", controller.stats);
router.get("/", controller.list);
router.get("/:id", controller.getOne);
/* Permanent delete — regular/sub admin ko yahan 403 milta hai. */
router.delete("/:id", requireSuperAdmin, controller.remove);

module.exports = router;
