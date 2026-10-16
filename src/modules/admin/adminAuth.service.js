const bcrypt = require("bcryptjs");
const Admin = require("./admin.model");
const AdminOTP = require("./adminOTP.model");
const generateAdminToken = require("../../utils/generateAdminToken");
const sendEmail = require("../../utils/sendEmail");
const { otpEmailTemplate } = require("../../utils/emailTemplates");
const { isValidEmail, isStrongPassword } = require("../../utils/validators");
const { freshOtp } = require("../../utils/otp");

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const OTP_EXPIRE_MINUTES = Number(process.env.OTP_EXPIRE_MINUTES) || 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

/*
==========================================
Authenticate an admin by email + password.
Throws an error with a statusCode when auth fails.
==========================================
*/
const authenticateAdmin = async (email, password) => {
  const admin = await Admin.findOne({ email: email.toLowerCase().trim() }).select("+password");

  if (!admin) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  if (!admin.isActive) {
    const error = new Error("This admin account has been deactivated");
    error.statusCode = 403;
    throw error;
  }

  const isMatch = await bcrypt.compare(password, admin.password);

  if (!isMatch) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  admin.lastLogin = new Date();
  await admin.save();

  const token = generateAdminToken(admin);

  const safeAdmin = admin.toObject();
  delete safeAdmin.password;

  return { token, admin: safeAdmin };
};

const getAdminById = async (id) => {
  const admin = await Admin.findById(id);

  if (!admin) {
    const error = new Error("Admin not found");
    error.statusCode = 404;
    throw error;
  }

  return admin;
};

/*
==========================================
Forgot Password — Step 1
Generates + emails a 6-digit OTP for the given admin email.
==========================================
*/
const requestPasswordReset = async (email) => {
  if (!isValidEmail(email)) throw badRequest("Enter a valid email address");

  const cleanEmail = email.toLowerCase().trim();

  const admin = await Admin.findOne({ email: cleanEmail });
  if (!admin) {
    const error = new Error("No admin account found with this email");
    error.statusCode = 404;
    throw error;
  }

  if (!admin.isActive) {
    const error = new Error("This admin account has been deactivated");
    error.statusCode = 403;
    throw error;
  }

  const existing = await AdminOTP.findOne({ email: cleanEmail });
  if (existing) {
    const ageSeconds = (Date.now() - existing.createdAt.getTime()) / 1000;
    if (ageSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
      throw badRequest(
        `Please wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - ageSeconds)}s before requesting another OTP`
      );
    }
  }

  const otp = freshOtp();

  await AdminOTP.deleteMany({ email: cleanEmail });
  await AdminOTP.create({
    email: cleanEmail,
    otp,
    expiresAt: new Date(Date.now() + OTP_EXPIRE_MINUTES * 60 * 1000),
  });

  await sendEmail({
    to: cleanEmail,
    subject: "Indexia Finance Admin — Password Reset OTP",
    html: otpEmailTemplate({ otp, minutes: OTP_EXPIRE_MINUTES }),
    text: `Your Indexia Finance Admin password reset OTP is ${otp}. It expires in ${OTP_EXPIRE_MINUTES} minutes.`,
  });
};

/*
==========================================
Forgot Password — Step 2
Verifies the OTP and sets the new password.
==========================================
*/
const resetPasswordWithOtp = async (email, otp, newPassword) => {
  if (!isValidEmail(email)) throw badRequest("Enter a valid email address");
  if (!otp) throw badRequest("OTP is required");
  if (!isStrongPassword(newPassword)) {
    throw badRequest("Password must be at least 8 characters and include a letter and a number");
  }

  const cleanEmail = email.toLowerCase().trim();

  const otpRecord = await AdminOTP.findOne({ email: cleanEmail });
  if (!otpRecord) {
    throw badRequest("OTP not found or expired. Please request a new one.");
  }

  if (otpRecord.expiresAt < new Date()) {
    await AdminOTP.deleteMany({ email: cleanEmail });
    throw badRequest("OTP expired. Please request a new one.");
  }

  if (otpRecord.otp !== String(otp).trim()) {
    throw badRequest("Invalid OTP");
  }

  const admin = await Admin.findOne({ email: cleanEmail });
  if (!admin) {
    const error = new Error("No admin account found with this email");
    error.statusCode = 404;
    throw error;
  }

  admin.password = await bcrypt.hash(newPassword, 10);
  await admin.save();

  await AdminOTP.deleteMany({ email: cleanEmail });
};

/*
==========================================
Change Password (authenticated)
==========================================
*/
const changePassword = async (adminId, currentPassword, newPassword) => {
  if (!currentPassword) throw badRequest("Current password is required");
  if (!isStrongPassword(newPassword)) {
    throw badRequest("New password must be at least 8 characters and include a letter and a number");
  }

  const admin = await Admin.findById(adminId).select("+password");
  if (!admin) {
    const error = new Error("Admin not found");
    error.statusCode = 404;
    throw error;
  }

  const isMatch = await bcrypt.compare(currentPassword, admin.password);
  if (!isMatch) throw badRequest("Current password is incorrect");

  const isSame = await bcrypt.compare(newPassword, admin.password);
  if (isSame) throw badRequest("New password must be different from your current password");

  admin.password = await bcrypt.hash(newPassword, 10);
  await admin.save();
};

/*
==========================================
Update Profile (authenticated) — name + email only.
==========================================
*/
const updateProfile = async (adminId, { name, email }) => {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) throw badRequest("Name is required");
  if (cleanName.length > 100) throw badRequest("Name is too long (max 100 characters)");

  if (!isValidEmail(email)) throw badRequest("Enter a valid email address");
  const cleanEmail = email.toLowerCase().trim();

  const admin = await Admin.findById(adminId);
  if (!admin) {
    const error = new Error("Admin not found");
    error.statusCode = 404;
    throw error;
  }

  if (cleanEmail !== admin.email) {
    const existing = await Admin.findOne({ email: cleanEmail });
    if (existing) throw badRequest("This email is already in use by another admin");
  }

  admin.name = cleanName;
  admin.email = cleanEmail;
  await admin.save();

  return admin;
};

module.exports = {
  authenticateAdmin,
  getAdminById,
  requestPasswordReset,
  resetPasswordWithOtp,
  changePassword,
  updateProfile,
};
