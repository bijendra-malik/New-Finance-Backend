const { body } = require("express-validator");
const handleValidationErrors = require("../../middleware/validation.middleware");

/*
==========================================
Entry validators.

Register/login nahi hai — sirf do step:

  1. POST /api/auth/:product      (customer)  ya  POST /api/franchise/entry
     Dono ka payload bilkul same hai: name, email, mobile, DOB, PAN +
     continent + country, with optional city and pincode.
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
 * Step 1 ke common field rules — customer ka per-loan entry aur franchise entry
 * dono inhi se shuru hote hain. Franchise entry iske aage plan/business ke apne
 * rules jodta hai (franchise.validator.js), isliye ye alag rakhe gaye hain.
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
  body("city").optional().trim(),
  body("pincode").optional().trim(),
];

/** Step 1 — customer ka entry form. */
const entryValidator = [...entryFieldRules, handleValidationErrors];

/** Step 2 — OTP verify. */
const verifyOtpValidator = [mobile(), otp(), handleValidationErrors];

module.exports = {
  entryFieldRules,
  entryValidator,
  verifyOtpValidator,
};
