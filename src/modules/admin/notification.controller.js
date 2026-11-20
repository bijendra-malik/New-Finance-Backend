const notificationService = require("./notification.service");

/*
==========================================
Notifications API — /api/admin/notifications

  GET    /            -> { success, notifications, total, unread, windowDays }
  POST   /read        -> body { keys: [] } (di gayi notifications read)
  POST   /read-all    -> poora current feed read
  DELETE /read        -> sab receipts clear (feed unread ho jaati hai)

Feed derive hoti hai (admin updates + reviews), isliye har signed-in admin ke
liye available hai — normal admin ko apne scope ke sabhi admins ke update aur
apne updates ka feedback milta hai.
==========================================
*/

exports.list = async (req, res, next) => {
  try {
    const feed = await notificationService.listNotifications(req.admin, req.query ?? {});

    res.json({ success: true, ...feed });
  } catch (error) {
    next(error);
  }
};

exports.markRead = async (req, res, next) => {
  try {
    const result = await notificationService.markRead(req.admin, req.body?.keys ?? []);

    res.json({
      success: true,
      message: "Notifications marked as read",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

exports.markAllRead = async (req, res, next) => {
  try {
    const result = await notificationService.markAllRead(req.admin, req.query ?? {});

    res.json({
      success: true,
      message: "All notifications marked as read",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

exports.resetRead = async (req, res, next) => {
  try {
    const result = await notificationService.resetRead(req.admin);

    res.json({
      success: true,
      message: "Read state cleared",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};
