const router = require("express").Router();

const franchiseController = require("./franchise.controller");

/*
==========================================
Admin franchise routes — mounted at /api/admin/franchises
(admin auth is applied by the parent router in src/modules/admin/index.js)

  GET    /                 list applications (?status=&search=&page=&limit=)
  GET    /:id              one application
  PATCH  /:id/approve      approve + mint FRN code + PAN password
  PATCH  /:id/reject       reject                 { note? }
  GET    /:id/loans        loans submitted through this FRN
==========================================
*/

router.get("/", franchiseController.list);
router.get("/:id", franchiseController.getOne);
router.patch("/:id/approve", franchiseController.approve);
router.patch("/:id/reject", franchiseController.reject);
router.get("/:id/loans", franchiseController.loans);

module.exports = router;
