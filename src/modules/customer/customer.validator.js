const { body } = require("express-validator");

const handleValidationErrors = require("../../middleware/validation.middleware");
const { buildProductApplyValidator } = require("../loans/shared/productApplyValidator");

/*
==========================================
Customer validators.

Sirf ek hai: loan apply. Purana step-1 ("apply-register", jo dob + PAN alag se
maangta tha) hata diya gaya — wahi details ab entry form (`POST /api/auth/:product`)
me aati hain aur OTP verify hone par account par save ho jaati hain.

Form ka config `GET /api/customer/loan-apply` se milta hai; submit yahin se hota hai.
==========================================
*/

/*
Body carries `product`, so the matching product's apply rules run at request
time — same rules as the per-product routes.
*/
const customerLoanApplyValidator = buildProductApplyValidator();

/*
Credit score check — customer apna score submit karta hai. Score 300-900 ke
beech hona chahiye; eligible/not-eligible ka faisla credit.service.js karta hai.
*/
const creditScoreValidator = [
  body("draftId")
    .trim()
    .notEmpty()
    .withMessage("Loan form draft ID is required")
    .bail()
    .isUUID()
    .withMessage("Enter a valid loan form draft ID"),
  body("creditScore")
    .exists({ checkNull: true })
    .withMessage("Credit score is required")
    .bail()
    .isInt({ min: 300, max: 900 })
    .withMessage("Enter a valid credit score between 300 and 900")
    .toInt(),
  handleValidationErrors,
];

const cancelCustomerLoanDraftValidator = [
  body("draftId")
    .trim()
    .notEmpty()
    .withMessage("Loan form draft ID is required")
    .bail()
    .isUUID()
    .withMessage("Enter a valid loan form draft ID"),
  handleValidationErrors,
];

module.exports = {
  customerLoanApplyValidator,
  creditScoreValidator,
  cancelCustomerLoanDraftValidator,
  handleValidationErrors,
};
