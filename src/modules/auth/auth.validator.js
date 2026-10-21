const { body } = require("express-validator");
const handleValidationErrors = require("../../middleware/validation.middleware");

/*
==========================================
Entry validators.

Register/login nahi hai — sirf do step:

  1. POST /api/auth/:product      (customer)  ya  POST /api/franchise/entry
     Customer: name, email, mobile, DOB, PAN, continent + country.
     Franchise ka entry alag hai aur uske extra fields franchise validator me hain.
  2. POST /api/auth/verify-otp    (customer)  ya  POST /api/franchise/entry/verify
     Mobile + OTP.

PAN yahan uppercase kar diya jaata hai, isliye service ko lowercase PAN ka
case handle nahi karna padta.
==========================================
*/

const mobile = () =>
  body("mobile")
    .trim()
    .matches(/^\d{10}$/)
    .withMessage("Enter a valid 10-digit mobile number");

const otp = () =>
  body("otp")
    .trim()
    .matches(/^\d{4,8}$/)
    .withMessage("Enter a valid OTP");

/**
 * Basic identity and location rules shared by customer and franchise entry.
 * Franchise-only fields are defined in franchise.validator.js.
 */
const entryFieldRules = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  mobile(),
  body("email")
    .trim()
    .isEmail()
    .withMessage("Enter a valid email address")
    .normalizeEmail(),
  body("dob")
    .trim()
    .notEmpty()
    .withMessage("Date of birth is required")
    .isISO8601()
    .withMessage("Enter a valid date of birth (YYYY-MM-DD)"),
  body("panNumber")
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .withMessage("Enter a valid PAN number (e.g. ABCDE1234F)"),
  /* Location fields are optional so older clients remain compatible. */
  body("continent").optional().trim(),
  body("country").optional().trim(),
];

/** Step 1 — customer ka entry form. */
const entryValidator = [...entryFieldRules, handleValidationErrors];

/** Customer login — sirf registered mobile number chahiye. */
const loginRequestValidator = [mobile(), handleValidationErrors];

/** Step 2 — OTP verify. */
const verifyOtpValidator = [mobile(), otp(), handleValidationErrors];

module.exports = {
  entryFieldRules,
  entryValidator,
  loginRequestValidator,
  verifyOtpValidator,
};
