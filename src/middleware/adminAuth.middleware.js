const jwt = require("jsonwebtoken");
const { TOKEN_TYPE } = require("../constants/roles");
const Admin = require("../modules/admin/admin.model");

/*
==========================================
Admin Auth Middleware
Verifies the JWT was issued to an admin (type: "admin"),
keeping admin sessions isolated from regular user sessions.
==========================================
*/

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid Token",
    });
  }

  if (decoded.type !== TOKEN_TYPE.ADMIN) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Admin access only",
    });
  }

  try {
    const admin = await Admin.findById(decoded.id).select("email role loanAccess isActive");

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

    req.admin = {
      id: String(admin._id),
      email: admin.email,
      role: admin.role,
      loanAccess: admin.loanAccess,
    };

    return next();
  } catch (err) {
    return next(err);
  }
};
