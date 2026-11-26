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
  PATCH  /:id/status       any status             { status, note? }
  PATCH  /:id/reset-password  re-hash the password from the PAN number
  GET    /:id/loans        loans submitted through this FRN
  DELETE /:id              permanently delete the account (super admin only)

Franchise module access hi guard hai (parent router lagaata hai): jise module
mila hai wo approve/reject/reset bhi kar sakta hai, chahe regular admin ho ya
sub admin. Sirf module access na ho to 403.
==========================================
*/

router.get("/", franchiseController.list);
router.get("/:id", franchiseController.getOne);
router.patch("/:id/approve", franchiseController.approve);
router.patch("/:id/reject", franchiseController.reject);
router.patch("/:id/status", franchiseController.setStatus);
router.patch("/:id/reset-password", franchiseController.resetPassword);
router.get("/:id/loans", franchiseController.loans);
/* Regular admin likhta hai; super admin ko yahan 403 milta hai. */
router.post("/:id/updates", franchiseController.addUpdate);

/* Permanent delete — regular/sub admin ko yahan 403 milta hai. */
router.delete("/:id", requireSuperAdmin, franchiseController.remove);

module.exports = router;
