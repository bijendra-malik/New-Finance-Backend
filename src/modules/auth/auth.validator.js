const { body } = require("express-validator");
const handleValidationErrors = require("../../middleware/validation.middleware");
const { USER_ROLE_VALUES } = require("../../constants/roles");

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

/*
Register accepts BOTH account types through one endpoint. `role`, `continent`
and `country` stay optional so older clients that only send name/mobile/email
keep working; when a role IS sent it must be a known one.
*/
const registerValidator = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  mobile(),
  body("email").trim().isEmail().withMessage("Enter a valid email address").normalizeEmail(),
  body("role")
    .optional()
    .trim()
    .isIn(USER_ROLE_VALUES)
    .withMessage(`Role must be one of: ${USER_ROLE_VALUES.join(", ")}`),
  body("continent").optional().trim().isString().withMessage("Continent must be text"),
  body("country").optional().trim().isString().withMessage("Country must be text"),
  handleValidationErrors,
];

const loginValidator = [mobile(), handleValidationErrors];

const verifyOtpValidator = [mobile(), otp(), handleValidationErrors];

const verifyLoginOtpValidator = [mobile(), otp(), handleValidationErrors];

module.exports = {
  registerValidator,
  loginValidator,
  verifyOtpValidator,
  verifyLoginOtpValidator,
};
