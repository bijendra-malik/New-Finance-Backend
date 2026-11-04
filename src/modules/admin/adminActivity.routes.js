const router = require("express").Router();

const adminAuth = require("../../middleware/adminAuth.middleware");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");
const adminActivityController = require("./adminActivity.controller");

/*
==========================================
Admin activity — /api/admin/activity

Super admin reporting ke liye reserved: pehle token (`adminAuth`), phir DB se
role (`requireSuperAdmin`). Ek hi route do kaam karta hai — har loan product
ke `adminUpdates` trail ko ek feed me jodta hai aur filters (admin/product/days)
lagata hai.
==========================================
*/

router.use(adminAuth, requireSuperAdmin);

router.get("/", adminActivityController.list);

module.exports = router;
