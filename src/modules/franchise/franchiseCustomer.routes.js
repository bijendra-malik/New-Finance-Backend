const router = require("express").Router();

const controller = require("./franchiseCustomer.controller");
const franchiseController = require("./franchise.controller");
const auth = require("../../middleware/auth.middleware");
const { requireApprovedFranchise } = require("../../middleware/franchise.middleware");
const { otpRequestLimiter } = require("../../middleware/rateLimit.middleware");
const normalizeApplyPayload = require("../../middleware/normalizeApplyPayload.middleware");
const mergeFranchiseCustomer = require("../../middleware/franchiseCustomer.middleware");
const { productFromParam } = require("../loans/shared/productApplyValidator");
const {
  franchiseCustomerValidator,
  franchiseCustomerUpdateValidator,
} = require("./franchiseCustomer.validator");
const {
  franchiseLoanApplyValidator,
  franchiseCustomerOtpValidator,
  franchiseCustomerCreditScoreValidator,
} = require("./franchise.validator");

/*
========================================
Franchise customer API — mounted at /api/franchise/customer
(APPROVED franchise only, franchise token)

  POST   /register                     naya customer register karo (OTP customer
                                       ke phone par jaata hai)
  POST   /verify-otp                   customer mobile + OTP -> CUST id banti hai
  GET    /:id/draft                    pending draft resume karein
  DELETE /:id/draft                    pending draft cancel karein
  POST   /:product/applyloan           usi customer ke liye loan apply karo
                                       e.g. /customer/personal/applyloan
                                            /customer/gold-loan/applyloan
                                       (customer id body me `franchiseCustomerId`)
  POST   /:id/credit-score             eligible score par pending loan finalize

  GET    /                             apne customers (search + pagination)
  GET    /:id                          ek customer ki poori detail
  PATCH  /:id                          details update
  GET    /:id/loans                    us customer ke saare loans + status/timeline
  GET    /:id/loans/:applicationNo     ek loan ka status (LOAN000001)

Flow seedha hai:

  1. POST /register          customer ki details save + uske phone par OTP
  2. POST /verify-otp        mobile + OTP match -> customer ka `users` account + CUST id
  3. POST /:product/applyloan loan form draft (customer verified hona zaroori hai)
  4. POST /:id/credit-score  eligible score par actual loan application submit
  5. GET /:id/draft           pending form ko baad mein resume karein

Loan apply product ko URL se leta hai; `productFromParam` us segment ko
LOAN_PRODUCTS key me badal kar body par pin kar deta hai, isliye usi product ke
normal validation rules chalti hain.
========================================
*/

router.post("/register", auth, requireApprovedFranchise, franchiseCustomerValidator, controller.register);

/* Customer ke phone par aaya OTP — verify hone par CUST id banti hai. */
router.post(
  "/verify-otp",
  auth,
  requireApprovedFranchise,
  franchiseCustomerOtpValidator,
  controller.verifyCustomerOtp
);

router.post("/resend-otp", auth, requireApprovedFranchise, otpRequestLimiter, controller.resendCustomerOtp);

router.post(
  "/:id/credit-score",
  auth,
  requireApprovedFranchise,
  franchiseCustomerCreditScoreValidator,
  controller.submitCustomerCreditScore
);

router.post(
  "/:product/applyloan",
  auth,
  requireApprovedFranchise,
  normalizeApplyPayload,
  productFromParam,
  mergeFranchiseCustomer,
  franchiseLoanApplyValidator,
  franchiseController.loanApply
);

router.get("/", auth, requireApprovedFranchise, controller.list);

router.get("/:id/draft", auth, requireApprovedFranchise, controller.getDraft);
router.delete("/:id/draft", auth, requireApprovedFranchise, controller.cancelDraft);

router.get("/:id", auth, requireApprovedFranchise, controller.getOne);

router.patch("/:id", auth, requireApprovedFranchise, franchiseCustomerUpdateValidator, controller.update);

// Customer ki loan tracking — franchise apne customer ka status dekhta hai
router.get("/:id/loans", auth, requireApprovedFranchise, controller.loans);

router.get("/:id/loans/:applicationNo", auth, requireApprovedFranchise, controller.loanDetail);

module.exports = router;
