const router = require("express").Router();

const statusController = require("./status.controller");
const { requestOtpValidator, statusValidator } = require("./status.validator");
const { otpRequestLimiter, otpVerifyLimiter } = require("../../middleware/rateLimit.middleware");

/*
========================================
Customer status API — mounted at /api/status

  POST /request-otp   { customerId, panNumber }         OTP registered mobile par
  POST /                { customerId, panNumber, otp }   status + process + timeline

Yahan koi token nahi hai (customer ka login nahi hota): identity CUST id + PAN se
aur mobile ka control OTP se prove hota hai. Bilkul public hai, isliye dono
endpoints par rate limit laga hai.
========================================
*/

router.post("/request-otp", otpRequestLimiter, requestOtpValidator, statusController.requestOtp);

router.post("/", otpVerifyLimiter, statusValidator, statusController.status);

module.exports = router;
