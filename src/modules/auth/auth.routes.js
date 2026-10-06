const router = require("express").Router();

const authController = require("./auth.controller");
const auth = require("../../middleware/auth.middleware");
const {
  requireCustomer,
  requireFranchise,
} = require("../../middleware/franchise.middleware");
const { otpRequestLimiter, otpVerifyLimiter } = require("../../middleware/rateLimit.middleware");
const {
  registerValidator,
  loginValidator,
  verifyOtpValidator,
  verifyLoginOtpValidator,
} = require("./auth.validator");

/*
========================================
Public Routes
========================================
*/

// Register User & Send OTP
router.post("/register", otpRequestLimiter, registerValidator, authController.register);

// Verify Register OTP
router.post("/verify-otp", otpVerifyLimiter, verifyOtpValidator, authController.verifyOTP);

// Login & Send OTP
router.post("/login", otpRequestLimiter, loginValidator, authController.login);

// Verify Login OTP
router.post("/login/verify", otpVerifyLimiter, verifyLoginOtpValidator, authController.verifyLoginOTP);

/*
========================================
Protected Routes
========================================
*/

// Role-specific profiles
router.get("/customer/profile", auth, requireCustomer, authController.customerProfile);
router.get("/franchise/profile", auth, requireFranchise, authController.franchiseProfile);

// Backward-compatible profile route
router.get("/profile", auth, authController.profile);

module.exports = router;
