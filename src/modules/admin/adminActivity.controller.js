const adminActivityService = require("./adminActivity.service");

/*
==========================================
GET /api/admin/activity  (`updates.view`, scope ke hisaab se filtered)

Query: adminId? product? days? limit?
Response: { success: true, activity }
==========================================
*/

exports.list = async (req, res, next) => {
  try {
    const activity = await adminActivityService.listActivity(
      req.query ?? {},
      req.admin
    );

    res.json({
      success: true,
      activity,
    });
  } catch (error) {
    next(error);
  }
};
