const router = require("express").Router();

const adminAuth = require("../../middleware/adminAuth.middleware");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");
const adminUserController = require("./adminUser.controller");

/*
==========================================
Admin team — /api/admin/admins

Sab routes super admin ke liye reserved hain: pehle token check (`adminAuth`),
phir DB se role check (`requireSuperAdmin`).
==========================================
*/

router.use(adminAuth, requireSuperAdmin);

router.get("/", adminUserController.list);

router.post("/", adminUserController.create);

router.patch("/:id", adminUserController.update);

router.put("/:id/password", adminUserController.resetPassword);

router.delete("/:id", adminUserController.remove);

module.exports = router;
