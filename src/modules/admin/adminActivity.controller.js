const adminActivityService = require("./adminActivity.service");

/*
==========================================
GET /api/admin/activity  (super admin only)

Query: adminId? product? days? limit?
Response: { success: true, activity }
==========================================
*/

exports.list = async (req, res, next) => {
  try {
    const activity = await adminActivityService.listActivity(req.query ?? {});

    res.json({
      success: true,
      activity,
    });
  } catch (error) {
    next(error);
  }
};
