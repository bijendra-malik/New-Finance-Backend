const { body } = require("express-validator");

const handleValidationErrors = require("../../middleware/validation.middleware");

/*
==========================================
Status door ke validators.

Yahan sirf ye dekha jaata hai ki field bheji gayi hai ya nahi (khaali request par
saaf 400). CUST id ka format, PAN ka format aur identity match
`status.service.js` me check hote hai — wahan message zyada saaf de paate hai.
==========================================
*/

const identityRules = [
  body("customerId").trim().notEmpty().withMessage("Customer ID is required"),
  body("panNumber").trim().notEmpty().withMessage("PAN number is required"),
];

exports.requestOtpValidator = [...identityRules, handleValidationErrors];

exports.statusValidator = [
  ...identityRules,
  body("otp").trim().notEmpty().withMessage("OTP is required"),
  handleValidationErrors,
];
