const { body } = require("express-validator");
const { PAN_PATTERN, MOBILE_PATTERN, PINCODE_PATTERN } = require("./helpers");

/* =========================================================================
 * STEP 6 — Personal Details (same fields for every product)
 * =========================================================================
 * fullName and mobile are ALWAYS required.
 * The rest become required only when config.personalDetailsRequired is true.
 * Applicant date of birth must indicate an age between 18 and 65 years.
 * ========================================================================= */

const MIN_APPLICANT_AGE = 18;
const MAX_APPLICANT_AGE = 65;

/** The applicant must be 18–65 years old, and the DOB cannot be in the future. */
const adultApplicantCheck = (value) => {
  const dob = new Date(value);
  const today = new Date();

  if (Number.isNaN(dob.getTime())) throw new Error("Enter a valid date of birth");

  const birthYear = dob.getUTCFullYear();
  const birthMonth = dob.getUTCMonth();
  const birthDay = dob.getUTCDate();
  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth();
  const currentDay = today.getUTCDate();
  let age = currentYear - birthYear;
  if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) age -= 1;

  if (age < MIN_APPLICANT_AGE || age > MAX_APPLICANT_AGE) {
    throw new Error(`Applicant must be between ${MIN_APPLICANT_AGE} and ${MAX_APPLICANT_AGE} years old`);
  }

  return true;
};

const personalDetailsRules = (config) => {
  const required = config.personalDetailsRequired;
  const requiredOrOptional = (field) => (required ? body(field) : body(field).optional());

  const chain = [
    body("fullName").trim().notEmpty().withMessage("Full name is required"),
    body("mobile").trim().matches(MOBILE_PATTERN).withMessage("Enter a valid 10-digit mobile number"),
    requiredOrOptional("email").trim().isEmail().withMessage("Enter a valid email address"),
    requiredOrOptional("dob")
      .isISO8601()
      .withMessage("Enter a valid date of birth")
      .custom(adultApplicantCheck),
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

module.exports = {
  personalDetailsRules,
  adultApplicantCheck,
  MIN_APPLICANT_AGE,
  MAX_APPLICANT_AGE,
};
