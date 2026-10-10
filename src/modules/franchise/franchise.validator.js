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
`panNumber` is checked here only for presence/format; the state/city/plan
presence checks live in the service so the same error shape is reused.

Plan ab do tarah se aa sakta hai:

  planCode -> published plan ka code ("3Y")   <- naya frontend: GET /api/franchise/plans
  package  -> free-text package name          <- purana client (backward compat)

Kam se kam ek bhejna zaroori hai. Dono na hon to yahin 400 mil jaata hai,
warna service me pahunche bina plan hi select nahi hua hota.
*/
const franchiseApplyValidator = [
  body("panNumber")
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .withMessage("Enter a valid PAN number (e.g. ABCDE1234F)"),
  body("state").trim().notEmpty().withMessage("State is required"),
  body("city").trim().notEmpty().withMessage("City is required"),
  body("planCode")
    .trim()
    .custom((value, { req }) => {
      const code = String(value ?? "").trim();
      const pkg = String(req.body?.package ?? "").trim();

      if (!code && !pkg) {
        throw new Error("Please select a franchise plan before applying");
      }
      if (code && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(code)) {
        throw new Error("Enter a valid franchise plan code (e.g. 3Y)");
      }
      return true;
    }),
  body("package").optional().trim(),
  handleValidationErrors,
];

/* Body carries `product`, so the matching product's rules run at request time. */
const franchiseLoanApplyValidator = buildProductApplyValidator();

module.exports = {
  franchiseLoginValidator,
  franchiseApplyValidator,
  franchiseLoanApplyValidator,
};
