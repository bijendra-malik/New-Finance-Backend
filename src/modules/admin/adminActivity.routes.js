const router = require("express").Router();

const adminAuth = require("../../middleware/adminAuth.middleware");
const { requirePermission } = require("./adminLoanAccess");
const adminActivityController = require("./adminActivity.controller");

/*
==========================================
Admin activity — /api/admin/activity

Pehle ye route sirf super admin ka tha. Ab sub admin bhi `updates.view` ke
saath ise padhta hai — service uska feed uske scope tak seemit karti hai aur
sirf regular admins ka kaam dikhati hai. Regular admin ke paas ye permission
nahi hoti, isliye uske liye 403 hi rehta hai.
==========================================
*/

router.use(adminAuth, requirePermission("updates.view"));

router.get("/", adminActivityController.list);

module.exports = router;
