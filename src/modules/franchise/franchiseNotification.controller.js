const notificationService = require("./franchiseNotification.service");

exports.list = async (req, res, next) => {
  try {
    const feed = await notificationService.listNotifications(req.franchise, req.query ?? {});
    res.json({ success: true, ...feed });
  } catch (error) {
    next(error);
  }
};

exports.markRead = async (req, res, next) => {
  try {
    const result = await notificationService.markRead(req.franchise, req.body?.keys ?? []);
    res.json({ success: true, message: "Notifications marked as read", ...result });
  } catch (error) {
    next(error);
  }
};

exports.markAllRead = async (req, res, next) => {
  try {
    const result = await notificationService.markAllRead(req.franchise, req.query ?? {});
    res.json({ success: true, message: "All notifications marked as read", ...result });
  } catch (error) {
    next(error);
  }
};

