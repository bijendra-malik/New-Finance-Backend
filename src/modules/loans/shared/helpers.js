const { body } = require("express-validator");

/* =========================================================================
 * helpers.js — small building blocks shared by every rules file.
 * =========================================================================
 * They keep the rules files short and easy to read. For example:
 *
 *   requiredIf("companyName", SALARIED, "Company name is required")
 *
 * means: "make companyName required, but only when the applicant chose Salaried".
 * ========================================================================= */

/* Employment type values (same as src/constants/employmentTypes.js). */
const SALARIED = "Salaried";
const BUSINESS = "Self Employed - Business";
const PROFESSIONAL = "Self Employed - Professional";
const SELF_EMPLOYED = [BUSINESS, PROFESSIONAL];

/* Reusable formats. */
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GST_PATTERN = /^[0-9A-Z]{15}$/;
const DATE_PATTERN = /^(\d{4}-\d{2}-\d{2}(?:T.*)?|\d{2}\/\d{2}\/\d{4})$/;
const PINCODE_PATTERN = /^\d{6}$/;
const MOBILE_PATTERN = /^[1-9]\d{9}$/;

/** Required only when the applicant picked this one employment type. */
const requiredIf = (field, employmentType, message) =>
  body(field)
    .if(body("employmentType").equals(employmentType))
    .trim()
    .notEmpty()
    .withMessage(message);

/** Required only when the applicant picked one of these employment types. */
const requiredForTypes = (field, employmentTypes, message) =>
  body(field)
    .if(body("employmentType").isIn(employmentTypes))
    .trim()
    .notEmpty()
    .withMessage(message);

/** Free-text field that appears when the applicant picks "Other" in a dropdown. */
const otherIf = (field, otherField, message) =>
  body(otherField)
    .if(body(field).equals("Other"))
    .trim()
    .notEmpty()
    .withMessage(message);

/** A non-negative amount, required only for one employment type. */
const amountIf = (field, employmentType, message) =>
  body(field)
    .if(body("employmentType").equals(employmentType))
    .isFloat({ min: 0 })
    .withMessage(message);

/** A 6-digit pincode, or the word "Other" when the dashboard lets the user type one. */
const pincodeOrOtherCheck = (message) => (value) => {
  if (value === "Other" || PINCODE_PATTERN.test(String(value))) return true;
  throw new Error(message);
};

module.exports = {
  SALARIED,
  BUSINESS,
  PROFESSIONAL,
  SELF_EMPLOYED,
  PAN_PATTERN,
  GST_PATTERN,
  DATE_PATTERN,
  PINCODE_PATTERN,
  MOBILE_PATTERN,
  requiredIf,
  requiredForTypes,
  otherIf,
  amountIf,
  pincodeOrOtherCheck,
};
