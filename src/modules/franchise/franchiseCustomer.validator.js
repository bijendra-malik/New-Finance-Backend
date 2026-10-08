const { body } = require("express-validator");

const handleValidationErrors = require("../../middleware/validation.middleware");
const { PAN_PATTERN, MOBILE_PATTERN, PINCODE_PATTERN } = require("../loans/shared/helpers");
const { adultApplicantCheck } = require("../loans/shared/personalDetails.rules");

/*
==========================================
Franchise customer validators.

Step 1 (register): basic details — inke bina bureau check ho hi nahi sakta,
isliye fullName + mobile + PAN + DOB mandatory hain.
Step 2 (cibil-check): customer ki likhit sehmati (consent) mandatory hai.
==========================================
*/

const optionalText = (field) => body(field).optional({ values: "falsy" }).trim().isString();

/*
Sirf normal customer wale fields — body me occupation / monthlyIncome /
gender / address / notes bhejne par wo kahin jaate bhi nahi (schema me nahi hain).
*/
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

/* Update: sab fields optional, par bheji gayi value valid honi chahiye. */
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

/*
Bureau check ke liye customer ki consent chahiye — bina consent check shuru hi
nahi hota, isliye ye rule mandatory hai (`consent: true`).
*/
const cibilCheckValidator = [
  body("consent")
    .custom((value) => {
      if (value === true || value === "true") return true;
      throw new Error("Customer consent is required for a credit bureau (CIBIL) check");
    }),
  handleValidationErrors,
];

module.exports = {
  franchiseCustomerValidator,
  franchiseCustomerUpdateValidator,
  cibilCheckValidator,
};
