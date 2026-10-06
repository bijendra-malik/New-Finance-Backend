const router = require("express").Router();

const customerController = require("./customer.controller");
const auth = require("../../middleware/auth.middleware");
const { requireCustomer } = require("../../middleware/franchise.middleware");
const normalizeApplyPayload = require("../../middleware/normalizeApplyPayload.middleware");
const { customerLoanApplyValidator, applyRegisterValidator } = require("./customer.validator");

/*
========================================
Customer API — mounted at /api/customer

  POST /apply-register          step 1: product + dob + PAN (validate only)
  POST /loan-apply              unified apply, `product` in the body
  GET  /loans                   all my applications, grouped (?status=)
  GET  /loans/:applicationNo    one application's status/stage (LOAN000001)
  GET  /loan-status?panNumber=  track my applications by PAN
  GET  /summary                 totals + counts by status + recent

The per-product routes (POST /api/personal-loan/apply, …) stay exactly as they
are — this is an additional, single-door entry point for the dashboard.
========================================
*/

/* Step 1 of the loan flow — basic details (dob + PAN) before the full form. */
router.post(
  "/apply-register",
  auth,
  requireCustomer,
  applyRegisterValidator,
  customerController.applyRegister
);

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
