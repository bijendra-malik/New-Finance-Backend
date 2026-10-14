const router = require("express").Router();

const customerController = require("./customer.controller");
const auth = require("../../middleware/auth.middleware");
const { requireCustomer } = require("../../middleware/franchise.middleware");
const normalizeApplyPayload = require("../../middleware/normalizeApplyPayload.middleware");
const { customerLoanApplyValidator } = require("./customer.validator");

/*
========================================
Customer API — mounted at /api/customer

  GET  /loan-apply              form ka config (?product=, ?employmentType=)
  POST /loan-apply              unified apply, `product` in the body
  GET  /loans                   all my applications, grouped (?status=)
  GET  /loans/:applicationNo    one application's status/stage (LOAN000001)
  GET  /loan-status?panNumber=  track my applications by PAN
  GET  /summary                 totals + counts by status + recent

The per-product routes (POST /api/personal-loan/apply, …) stay exactly as they
are — this is an additional, single-door entry point for the dashboard.
========================================
*/

/*
Loan form ka CONFIG (GET) — kis product me kaunse field aate hain.
Verify-otp ke baad client yahi call karta hai, phir form bharkar POST karta hai.
*/
router.get("/loan-apply", auth, requireCustomer, customerController.loanApplyForm);

router.post(
  "/loan-apply",
  auth,
  requireCustomer,
  normalizeApplyPayload,
  customerLoanApplyValidator,
  customerController.loanApply
);

router.get("/loans", auth, requireCustomer, customerController.loans);

/* Static routes must come BEFORE "/loans/:applicationNo" so they are not
   swallowed as an application number. */
router.get("/loan-status", auth, requireCustomer, customerController.loanStatusByPan);
router.get("/summary", auth, requireCustomer, customerController.summary);

router.get("/loans/:applicationNo", auth, requireCustomer, customerController.loanDetail);

module.exports = router;
