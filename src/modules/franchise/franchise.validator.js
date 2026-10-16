const { body } = require("express-validator");

const handleValidationErrors = require("../../middleware/validation.middleware");
const { buildProductApplyValidator } = require("../loans/shared/productApplyValidator");
const { entryFieldRules } = require("../auth/auth.validator");

/*
==========================================
Franchise validators.
==========================================
*/

const franchiseLoginValidator = [
  body("franchiseId").trim().notEmpty().withMessage("Franchise ID is required"),
  body("password").notEmpty().withMessage("Password is required"),
  handleValidationErrors,
];

/*
Franchise ENTRY — basic details (shared entry fields) + plan + business data.

Plan ab do tarah se aa sakta hai:

  planCode -> published plan ka code ("3Y")    <- naya frontend: GET /api/franchise/plans
  package  -> free-text package name           <- purana client (backward compat)

Kam se kam ek bhejna zaroori hai.
*/
const franchiseEntryValidator = [
  ...entryFieldRules,
  body("planCode")
    .trim()
    .custom((value, { req }) => {
      const code = String(value ?? "").trim();
      const pkg = String(req.body?.package ?? "").trim();

      if (!code && !pkg) {
        throw new Error("Please select a franchise plan before continuing");
      }
      if (code && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(code)) {
        throw new Error("Enter a valid franchise plan code (e.g. 3Y)");
      }
      return true;
    }),
  body("package").optional().trim(),
  body("businessName").optional().trim(),
  body("businessType").optional().trim(),
  body("gstNumber").optional().trim().toUpperCase(),
  body("address").optional().trim(),
  body("yearsInBusiness").optional().trim(),
  handleValidationErrors,
];

/* Public franchise status lookup: prove identity, then verify OTP. */
const franchiseStatusOtpRequestValidator = [
  body("mobile")
    .trim()
    .matches(/^\d{10}$/)
    .withMessage("Enter a valid 10-digit mobile number"),
  body("panNumber")
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .withMessage("Enter a valid PAN number (e.g. ABCDE1234F)"),
  handleValidationErrors,
];

const franchiseStatusValidator = [
  body("mobile")
    .trim()
    .matches(/^\d{10}$/)
    .withMessage("Enter a valid 10-digit mobile number"),
  body("otp")
    .trim()
    .matches(/^\d{4,8}$/)
    .withMessage("Enter a valid OTP"),
  handleValidationErrors,
];

/* Body carries `product`, so the matching product's rules run at request time. */
const franchiseLoanApplyValidator = buildProductApplyValidator();

/* Franchise apne customer ka OTP verify karta hai — customer ka record + OTP. */
const franchiseCustomerOtpValidator = [
  body("franchiseCustomerId").trim().notEmpty().withMessage("franchiseCustomerId is required"),
  body("otp")
    .trim()
    .matches(/^\d{4,8}$/)
    .withMessage("Enter a valid OTP"),
  handleValidationErrors,
];

module.exports = {
  franchiseLoginValidator,
  franchiseEntryValidator,
  franchiseStatusOtpRequestValidator,
  franchiseStatusValidator,
  franchiseLoanApplyValidator,
  franchiseCustomerOtpValidator,
};
