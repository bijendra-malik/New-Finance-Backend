const router = require("express").Router();

const franchiseController = require("./franchise.controller");
const franchisePlanController = require("./franchisePlan.controller");
const auth = require("../../middleware/auth.middleware");
const {
  requireFranchise,
  loadFranchise,
  requireApprovedFranchise,
} = require("../../middleware/franchise.middleware");
const {
  adminLoginLimiter,
  otpRequestLimiter,
  otpVerifyLimiter,
} = require("../../middleware/rateLimit.middleware");
const { verifyOtpValidator } = require("../auth/auth.validator");
const {
  franchiseLoginValidator,
  franchiseEntryValidator,
  franchiseStatusOtpRequestValidator,
  franchiseStatusValidator,
} = require("./franchise.validator");

/*
========================================
Franchise API — mounted at /api/franchise

  GET  /plans        published investment plans             (public)
  POST /entry        franchise banna: details + plan + OTP   (public)
  POST /entry/verify OTP match -> account + token            (public)
                     (franchiseStatus = Pending, admin approve karega)
  POST /login        franchiseId + password -> JWT          (public)
  GET  /profile      entry data + status    (franchise token)
  POST /status/request-otp identity check -> registered mobile OTP (public)
  POST /status       OTP verify -> approval status (public)
  GET  /status       approval status (franchise token)
  GET  /loans        loans via this FRN     (APPROVED franchise only)

Franchise ke apne CUSTOMERS aur unke loans alag router me hain:

  POST /customer/register                   customer save (+ OTP customer ko)
  POST /customer/verify-otp                 customer ka OTP verify
  POST /customer/:product/applyloan         loan apply
  GET  /customer, /customer/:id, ...
  (poori list aur comments: franchiseCustomer.routes.js)
========================================
*/

// Public
/*
Franchise investment plans. Ye published price list hai — koi PII nahi,
isliye bina login ke bhi khulti hai taaki naya visitor plans dekh kar
apply kar sake. Admin inhe /api/admin/franchise-plans se manage karta hai.
*/
router.get("/plans", franchisePlanController.list);

/*
Franchise ka entry — customer wale /api/auth/:product jaisa hi do-step hai, bas
yahan koi loan product nahi hota; uski jagah plan + business data aata hai. OTP
verify hone par franchise account banta hai, plan snapshot utarta hai, aur
franchiseStatus seedha Pending ho jaata hai. FRN code aur password admin approve
karne par hi milte hain.
*/
router.post("/entry", otpRequestLimiter, franchiseEntryValidator, franchiseController.entry);
router.post("/entry/verify", otpVerifyLimiter, verifyOtpValidator, franchiseController.verifyEntry);

router.post(
  "/status/request-otp",
  otpRequestLimiter,
  franchiseStatusOtpRequestValidator,
  franchiseController.requestStatusOtp
);
router.post("/status", otpVerifyLimiter, franchiseStatusValidator, franchiseController.publicStatus);

router.post("/login", adminLoginLimiter, franchiseLoginValidator, franchiseController.login);

// Franchise ka apna customer — register + loan apply
router.use("/customer", require("./franchiseCustomer.routes"));

// Franchise (any approval status)
router.get("/profile", auth, requireFranchise, loadFranchise, franchiseController.profile);
router.get("/status", auth, requireFranchise, loadFranchise, franchiseController.status);

// Approved franchise only
router.get("/loans", auth, requireApprovedFranchise, franchiseController.myLoans);

module.exports = router;
