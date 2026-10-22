const { body } = require("express-validator");

const handleValidationErrors = require("../../middleware/validation.middleware");
const { MOBILE_PATTERN } = require("../loans/shared/helpers");

/*
==========================================
Status door validators.

OTP request me customer ID, PAN aur mobile chahiye. OTP verify request me sirf
mobile aur OTP chahiye; customer ko registered mobile se resolve kiya jaata hai.
==========================================
*/

const identityRules = [
  body("customerId").trim().notEmpty().withMessage("Customer ID is required"),
  body("panNumber").trim().notEmpty().withMessage("PAN number is required"),
];

const mobileRule = () =>
  body("mobile")
    .trim()
    .matches(MOBILE_PATTERN)
    .withMessage("Enter a valid 10-digit mobile number");

exports.requestOtpValidator = [...identityRules, mobileRule(), handleValidationErrors];

exports.statusValidator = [
  mobileRule(),
  body("otp")
    .trim()
    .matches(/^\d{4,8}$/)
    .withMessage("Enter a valid OTP"),
  handleValidationErrors,
];
