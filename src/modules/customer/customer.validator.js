const { body } = require("express-validator");

const handleValidationErrors = require("../../middleware/validation.middleware");
const { buildProductApplyValidator } = require("../loans/shared/productApplyValidator");

/*
==========================================
Customer validators.
==========================================
*/

/*
Step 1 — "Apply register": the product the applicant clicked plus the two basic
details (DOB + PAN). Format checked here; the product lookup and the 18+ age
rule live in the service.
*/
const applyRegisterValidator = [
  body("product").trim().notEmpty().withMessage("Loan product is required"),
  body("panNumber")
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .withMessage("Enter a valid PAN number (e.g. ABCDE1234F)"),
  body("dob").trim().notEmpty().withMessage("Date of birth is required"),
  handleValidationErrors,
];

/*
Body carries `product`, so the matching product's apply rules run at request
time — same rules as the per-product routes.
*/
const customerLoanApplyValidator = buildProductApplyValidator();

module.exports = { applyRegisterValidator, customerLoanApplyValidator };