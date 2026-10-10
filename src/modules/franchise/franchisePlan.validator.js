const { body } = require("express-validator");

const handleValidationErrors = require("../../middleware/validation.middleware");

/*
==========================================
Franchise plan validators (admin CRUD).

Yahan sirf shape/format check hota hai. Business rules — jaise "ek waqt par
ek hi Best Value plan", "kam se kam ek plan active rahe", yenumerate "code
duplicate na ho" — service (franchisePlan.service.js) me hain, kyunki unke
liye DB dekhna padta hai.
==========================================
*/

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;
const MAX_FEATURES = 20;

const codeRule = ({ required }) => {
  const chain = body("code").trim();
  return (required ? chain.notEmpty().withMessage("Plan code is required") : chain.optional())
    .toUpperCase()
    .matches(CODE_PATTERN)
    .withMessage(
      "Plan code must be 1-20 characters — letters, numbers, hyphen or underscore only (e.g. 3Y)"
    );
};

const nameRule = ({ required }) => {
  const chain = body("name").trim();
  return (required ? chain.notEmpty().withMessage("Plan name is required") : chain.optional())
    .isLength({ max: 100 })
    .withMessage("Plan name is too long (max 100 characters)");
};

const durationRule = ({ required }) => {
  const chain = body("durationMonths");
  return (required
    ? chain.notEmpty().withMessage("Duration (in months) is required")
    : chain.optional()
  )
    .isInt({ min: 1 })
    .withMessage("Duration must be a whole number of months (1 or more)")
    .toInt();
};

const feeRule = ({ required }) => {
  const chain = body("fee");
  return (required ? chain.notEmpty().withMessage("Fee is required") : chain.optional())
    .isFloat({ min: 0 })
    .withMessage("Fee must be a number (0 or more)")
    .toFloat();
};

const gstPercentRule = () =>
  body("gstPercent")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("GST percent must be a number between 0 and 100")
    .toFloat();

/* null bhejne ka matlab hai "fixed renewal fee nahi hai" — allowed hai. */
const renewalFeeRule = () =>
  body("renewalFee")
    .optional({ values: "null" })
    .isFloat({ min: 0 })
    .withMessage("Renewal fee must be a number (0 or more)")
    .toFloat();

const renewalNoteRule = () =>
  body("renewalNote")
    .optional()
    .trim()
    .isLength({ max: 150 })
    .withMessage("Renewal note is too long (max 150 characters)");

const featuresRule = () =>
  body("features")
    .optional()
    .isArray({ max: MAX_FEATURES })
    .withMessage(`A plan can have at most ${MAX_FEATURES} features`)
    .custom((features) =>
      features.every((feature) => typeof feature === "string" && feature.length <= 200)
    )
    .withMessage("Each feature must be text (max 200 characters)");

const booleanRule = (field) =>
  body(field)
    .optional()
    .isBoolean()
    .withMessage(`${field} must be true or false`)
    .toBoolean();

const sortOrderRule = () =>
  body("sortOrder")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Sort order must be a whole number (0 or more)")
    .toInt();

const createPlanValidator = [
  codeRule({ required: true }),
  nameRule({ required: true }),
  durationRule({ required: true }),
  feeRule({ required: true }),
  gstPercentRule(),
  renewalFeeRule(),
  renewalNoteRule(),
  featuresRule(),
  booleanRule("isActive"),
  booleanRule("isBestValue"),
  sortOrderRule(),
  handleValidationErrors,
];

const updatePlanValidator = [
  codeRule({ required: false }),
  nameRule({ required: false }),
  durationRule({ required: false }),
  feeRule({ required: false }),
  gstPercentRule(),
  renewalFeeRule(),
  renewalNoteRule(),
  featuresRule(),
  booleanRule("isActive"),
  booleanRule("isBestValue"),
  sortOrderRule(),
  handleValidationErrors,
];

const setBestValueValidator = [
  body("isBestValue")
    .optional()
    .isBoolean()
    .withMessage("isBestValue must be true or false")
    .toBoolean(),
  handleValidationErrors,
];

const setStatusValidator = [
  body("isActive")
    .exists()
    .withMessage("isActive is required")
    .isBoolean()
    .withMessage("isActive must be true or false")
    .toBoolean(),
  handleValidationErrors,
];

module.exports = {
  createPlanValidator,
  updatePlanValidator,
  setBestValueValidator,
  setStatusValidator,
  CODE_PATTERN,
};
