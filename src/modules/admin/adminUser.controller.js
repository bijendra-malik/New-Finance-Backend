const adminUserService = require("./adminUser.service");

/*
==========================================
Admin team (/admins) — super admin only.

Responses follow the usual envelope:
  success → { success: true, message, admin | admins }
  failure → thrown error with statusCode → error middleware
==========================================
*/

// GET /api/admin/admins
exports.list = async (req, res, next) => {
  try {
    const admins = await adminUserService.listAdmins();

    res.json({
      success: true,
      admins,
      // UI shows these seats as "used / limit" and blocks the create button.
      limits: { regularAdmins: adminUserService.MAX_REGULAR_ADMINS },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/admin/admins
exports.create = async (req, res, next) => {
  try {
    const admin = await adminUserService.createAdmin(req.body ?? {});

    res.status(201).json({
      success: true,
      message: "Admin created successfully",
      admin,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/admin/admins/:id
exports.update = async (req, res, next) => {
  try {
    const admin = await adminUserService.updateAdmin(
      req.params.id,
      req.body ?? {},
      req.admin.id
    );

    res.json({
      success: true,
      message: "Admin updated successfully",
      admin,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/admins/:id/password
// Body: { password, currentPassword } — currentPassword = signed-in super admin's own password.
exports.resetPassword = async (req, res, next) => {
  try {
    await adminUserService.resetAdminPassword(
      req.params.id,
      req.body?.password,
      req.admin.id,
      req.body?.currentPassword
    );

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/admin/admins/:id
exports.remove = async (req, res, next) => {
  try {
    const purged = await adminUserService.deleteAdmin(req.params.id, req.admin.id);

    res.json({
      success: true,
      message: purged.removedFrom
        ? `Admin deleted successfully along with their updates on ${purged.removedFrom} record(s)`
        : "Admin deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
