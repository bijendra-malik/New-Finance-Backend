const Admin = require("../modules/admin/admin.model");

/*
==========================================
Super Admin Guard

`adminAuth` sirf token verify karta hai. Team / loan-access manage karna
sirf SuperAdmin ka kaam hai, isliye role DB se dobara padha jaata hai —
token purana ho sakta hai (role change ke baad bhi).

Use: router.use(adminAuth, requireSuperAdmin)
==========================================
*/

module.exports = async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.admin?.id).select("role isActive");

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: "This admin account has been deactivated",
      });
    }

    if (admin.role !== "SuperAdmin") {
      return res.status(403).json({
        success: false,
        message: "Only a super admin can access this resource",
      });
    }

    req.adminDoc = admin;

    next();
  } catch (error) {
    next(error);
  }
};
