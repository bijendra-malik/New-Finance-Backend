const { body } = require("express-validator");

const handleValidationErrors = require("../../middleware/validation.middleware");
const { buildProductApplyValidator } = require("../loans/shared/productApplyValidator");

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
`panNumber` is checked here only for presence/format; the state/city/package
presence checks live in the service so the same error shape is reused.
*/
const franchiseApplyValidator = [
  body("panNumber")
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .withMessage("Enter a valid PAN number (e.g. ABCDE1234F)"),
  body("state").trim().notEmpty().withMessage("State is required"),
  body("city").trim().notEmpty().withMessage("City is required"),
  body("package").trim().notEmpty().withMessage("Package is required"),
  handleValidationErrors,
];

/* Body carries `product`, so the matching product's rules run at request time. */
const franchiseLoanApplyValidator = buildProductApplyValidator();

module.exports = {
  franchiseLoginValidator,
  franchiseApplyValidator,
  franchiseLoanApplyValidator,
};
