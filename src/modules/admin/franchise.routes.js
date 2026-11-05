const router = require("express").Router();

const franchiseController = require("./franchise.controller");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");

/*
==========================================
Admin franchise routes — mounted at /api/admin/franchises
(admin auth is applied by the parent router in src/modules/admin/index.js)

  GET    /                 list applications (?status=&search=&page=&limit=)
  GET    /:id              one application
  PATCH  /:id/approve      approve + mint FRN code + PAN password
  PATCH  /:id/reject       reject                 { note? }
  PATCH  /:id/reset-password  re-hash the password from the PAN number
  GET    /:id/loans        loans submitted through this FRN
==========================================
*/

router.get("/", franchiseController.list);
router.get("/:id", franchiseController.getOne);
router.patch("/:id/approve", requireSuperAdmin, franchiseController.approve);
router.patch("/:id/reject", requireSuperAdmin, franchiseController.reject);
router.patch("/:id/reset-password", requireSuperAdmin, franchiseController.resetPassword);
router.get("/:id/loans", requireSuperAdmin, franchiseController.loans);
/* Regular admin likhta hai; super admin ko yahan 403 milta hai. */
router.post("/:id/updates", franchiseController.addUpdate);

module.exports = router;
