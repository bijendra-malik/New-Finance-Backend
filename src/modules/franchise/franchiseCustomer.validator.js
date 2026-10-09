const { body } = require("express-validator");

const handleValidationErrors = require("../../middleware/validation.middleware");
const { PAN_PATTERN, MOBILE_PATTERN, PINCODE_PATTERN } = require("../loans/shared/helpers");
const { adultApplicantCheck } = require("../loans/shared/personalDetails.rules");

/*
==========================================
Franchise customer validators.

Register: customer ki basic details. Ye fields loan application ka base hain,
isliye fullName + mobile + PAN + DOB mandatory hain aur applicant adult hona
chahiye. Baaki (email/state/city/pincode) optional hain.

Update: saare fields optional, par jo bheji gayi value valid honi chahiye.
==========================================
*/

const optionalText = (field) => body(field).optional({ values: "falsy" }).trim().isString();

const franchiseCustomerValidator = [
  body("fullName").trim().notEmpty().withMessage("Customer full name is required"),
  body("mobile").trim().matches(MOBILE_PATTERN).withMessage("Enter a valid 10-digit mobile number"),
  body("panNumber")
    .trim()
    .toUpperCase()
    .matches(PAN_PATTERN)
    .withMessage("Enter a valid PAN number (e.g. ABCDE1234F)"),
  body("dob").isISO8601().withMessage("Enter a valid date of birth").custom(adultApplicantCheck),
  body("email").optional({ values: "falsy" }).trim().isEmail().withMessage("Enter a valid email address"),
  optionalText("state"),
  optionalText("city"),
  body("pincode")
    .optional({ values: "falsy" })
    .trim()
    .matches(PINCODE_PATTERN)
    .withMessage("Enter a valid 6-digit pincode"),
  handleValidationErrors,
];

const franchiseCustomerUpdateValidator = [
  body("fullName").optional({ values: "falsy" }).trim().notEmpty().withMessage("Customer full name is required"),
  body("mobile")
    .optional({ values: "falsy" })
    .trim()
    .matches(MOBILE_PATTERN)
    .withMessage("Enter a valid 10-digit mobile number"),
  body("panNumber")
    .optional({ values: "falsy" })
    .trim()
    .toUpperCase()
    .matches(PAN_PATTERN)
    .withMessage("Enter a valid PAN number (e.g. ABCDE1234F)"),
  body("dob").optional({ values: "falsy" }).isISO8601().withMessage("Enter a valid date of birth"),
  body("email").optional({ values: "falsy" }).trim().isEmail().withMessage("Enter a valid email address"),
  body("pincode")
    .optional({ values: "falsy" })
    .trim()
    .matches(PINCODE_PATTERN)
    .withMessage("Enter a valid 6-digit pincode"),
  handleValidationErrors,
];

module.exports = {
  franchiseCustomerValidator,
  franchiseCustomerUpdateValidator,
};
