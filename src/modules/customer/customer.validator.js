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

module.exports = { customerLoanApplyValidator, handleValidationErrors };
