const router = require("express").Router();

const adminAuth = require("../../middleware/adminAuth.middleware");
const notificationController = require("./notification.controller");

/*
==========================================
Notifications — /api/admin/notifications

Har signed-in admin ke liye khula hai (koi capability required nahi): normal
admin ko bhi team ke updates aur apne updates par aaya feedback dikhna chahiye.
Role ke hisaab se audience service filter karti hai, isliye ek admin doosre ka
data nahi dekh sakta.

Read state admin-specific hai (`NotificationRead`), isliye do admins ek hi
notification par alag read state rakh sakte hain.
==========================================
*/

router.use(adminAuth);

router.get("/", notificationController.list);

router.post("/read", notificationController.markRead);
router.post("/read-all", notificationController.markAllRead);

/* Debug / "mark everything unread" ke liye. */
router.delete("/read", notificationController.resetRead);

module.exports = router;
