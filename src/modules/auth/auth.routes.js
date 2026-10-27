const router = require("express").Router();

const authController = require("./auth.controller");
const auth = require("../../middleware/auth.middleware");
const {
  requireCustomer,
  requireFranchise,
} = require("../../middleware/franchise.middleware");
const { otpRequestLimiter, otpVerifyLimiter } = require("../../middleware/rateLimit.middleware");
const { productFromParam } = require("../loans/shared/productApplyValidator");
const {
  entryValidator,
  loginRequestValidator,
  verifyOtpValidator,
} = require("./auth.validator");

/*
========================================
Auth API — mounted at /api/auth

Register / signup / login NAHI hai. Loan ka darwaza yahi hai:

  POST /:product          step 1 — loan click: details + OTP
                          (/api/auth/personal-loan, /api/auth/gold-loan,
                           /api/auth/credit-card … saare 18 products)
  POST /verify-otp        step 2 — OTP match par account + CUST id + token

Us token se aage: POST /api/customer/loan-apply (loan form).

Customer apna process sirf status se dekhta hai — uska koi login nahi.
Franchise ka alag darwaza hai: POST /api/franchise/entry.
========================================
*/

// Step 2 — OTP verify (yahan account + CUST id + token banta hai)
router.post("/verify-otp", otpVerifyLimiter, verifyOtpValidator, authController.verifyOTP);

/*
Existing customer login (phone + OTP). Naya account nahi banta; login token
product-locked nahi hota, isliye credit score check ke baad koi bhi loan apply
ho sakta hai. OTP verification selected product ke 30-day repeat-application
cooldown ko check karti hai.
*/
router.post("/login/request-otp", otpRequestLimiter, loginRequestValidator, authController.loginRequestOtp);
router.post(
  "/login/:product/verify-otp",
  otpVerifyLimiter,
  productFromParam,
  verifyOtpValidator,
  authController.loginVerify
);

/* Profiles (token ke role se alag-alag). */
router.get("/customer/profile", auth, requireCustomer, authController.customerProfile);
router.get("/franchise/profile", auth, requireFranchise, authController.franchiseProfile);
router.get("/profile", auth, authController.profile);

/*
Step 1 — per-loan entry.

Ye dynamic route SABSE aakhir me hai: warna "/verify-otp" jaise fixed paths
isi `:product` me fas jaate. `productFromParam` URL ke segment ko product key
me badalta hai (personal-loan -> personal, gold-loan -> goldLoan, …) aur
unknown product par 400 de deta hai.
*/
router.post("/:product", otpRequestLimiter, productFromParam, entryValidator, authController.entry);

module.exports = router;
