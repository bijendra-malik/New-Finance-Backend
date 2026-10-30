const { body } = require("express-validator");
const handleValidationErrors = require("../../middleware/validation.middleware");
const { isValidEmail } = require("../../utils/validators");

/*
Login `email` field email ya admin ID (loginId) dono le sakta hai — super admin
naye admins ko `admin02` jaisi chhoti ID deta hai. Actual lookup
`adminAuth.service` me hota hai.
*/
const loginValidator = [
  body("email")
    .trim()
    .custom((value) => isValidEmail(value) || /^[a-z0-9][a-z0-9._-]{2,23}$/i.test(value))
    .withMessage("Enter a valid email address or admin ID"),
  body("password").notEmpty().withMessage("Password is required"),
  handleValidationErrors,
];

const forgotPasswordValidator = [
  body("email").trim().isEmail().withMessage("Enter a valid email address"),
  handleValidationErrors,
];

const resetPasswordValidator = [
  body("email").trim().isEmail().withMessage("Enter a valid email address"),
  body("otp")
    .trim()
    .matches(/^\d{4,8}$/)
    .withMessage("Enter a valid OTP"),
  body("newPassword")
    .matches(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/)
    .withMessage("Password must be at least 8 characters and include a letter and a number"),
  handleValidationErrors,
];

const changePasswordValidator = [
  body("currentPassword").notEmpty().withMessage("Current password is required"),
  body("newPassword")
    .matches(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/)
    .withMessage("Password must be at least 8 characters and include a letter and a number"),
  handleValidationErrors,
];

module.exports = {
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
};
