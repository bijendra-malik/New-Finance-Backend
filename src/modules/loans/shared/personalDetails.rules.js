const { body } = require("express-validator");
const { PAN_PATTERN, MOBILE_PATTERN, PINCODE_PATTERN } = require("./helpers");

/* =========================================================================
 * STEP 6 — Personal Details (same fields for every product)
 * =========================================================================
 * fullName and mobile are ALWAYS required.
 * The rest become required only when config.personalDetailsRequired is true.
 * ========================================================================= */

const personalDetailsRules = (config) => {
  const required = config.personalDetailsRequired;
  const requiredOrOptional = (field) => (required ? body(field) : body(field).optional());

  const chain = [
    body("fullName").trim().notEmpty().withMessage("Full name is required"),
    body("mobile").trim().matches(MOBILE_PATTERN).withMessage("Enter a valid 10-digit mobile number"),
    requiredOrOptional("email").trim().isEmail().withMessage("Enter a valid email address"),
    requiredOrOptional("dob")
      .isISO8601()
      .withMessage("Enter a valid date of birth"),
    requiredOrOptional("panNumber").trim().matches(PAN_PATTERN).withMessage("Enter a valid PAN number"),
  ];

  if (required) {
    chain.push(body("state").trim().notEmpty().withMessage("State is required"));
    chain.push(body("city").trim().notEmpty().withMessage("City is required"));
  }

  chain.push(
    requiredOrOptional("pincode").trim().matches(PINCODE_PATTERN).withMessage("Enter a valid 6-digit pincode")
  );

  if (required) {
    chain.push(body("residenceStatus").trim().notEmpty().withMessage("Residence status is required"));
  }

  return chain;
};

module.exports = { personalDetailsRules };
