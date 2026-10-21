const router = require("express").Router();

const customerController = require("./customer.controller");
const auth = require("../../middleware/auth.middleware");
const { requireCustomer } = require("../../middleware/franchise.middleware");
const normalizeApplyPayload = require("../../middleware/normalizeApplyPayload.middleware");
const verifyEntryDetails = require("../../middleware/entryDetails.middleware");
const requireEntryProduct = require("../../middleware/entryProduct.middleware");
const { customerLoanApplyValidator, creditScoreValidator } = require("./customer.validator");

/*
========================================
Customer API — mounted at /api/customer

  POST /status/request-otp      public status OTP request (CUST id + PAN + mobile)
  POST /status                  public status lookup (mobile + OTP)
  GET  /loan-apply              form ka config (?product=, ?employmentType=)
  POST /loan-apply              save a temporary draft, `product` in the body
  POST /credit-score            eligible score submits the pending draft
  GET  /loans                   all my applications, grouped (?status=)
  GET  /loans/:applicationNo    one application's status/stage (LOAN000001)
  GET  /loan-status?panNumber=  track my applications by PAN
  GET  /summary                 totals + counts by status + recent

The per-product routes (POST /api/personal-loan/apply, …) stay exactly as they
are — this is an additional, single-door entry point for the dashboard.
========================================
*/

/* Public status routes: intentionally mounted before protected customer routes. */
router.use("/status", require("../status/status.routes"));

/*
GET  /loan-apply   form ka config — kis employment type me kaunse field +
                   entry par verify hui details (prefill) + bhari hui application
POST /loan-apply   temporary loan-form draft, `product` in the body

`verifyEntryDetails` form ki identity details ko entry par verify hui details se
match karta hai (name / mobile / email / DOB / PAN) — mismatch par 400.
*/
router.get("/loan-apply", auth, requireCustomer, customerController.loanApplyForm);

router.post(
  "/loan-apply",
  auth,
  requireCustomer,
  normalizeApplyPayload,
  requireEntryProduct((req) => req.body?.product),
  customerLoanApplyValidator,
  verifyEntryDetails,
  customerController.loanApply
);

/*
Credit score door — eligible score finalizes the pending loan-form draft.
Eligible score starts the existing 24-hour window.
*/
router.get("/credit-score", auth, requireCustomer, customerController.creditScoreStatus);
router.post("/credit-score", auth, requireCustomer, creditScoreValidator, customerController.checkCreditScore);

router.get("/loans", auth, requireCustomer, customerController.loans);

/* Static routes must come BEFORE "/loans/:applicationNo" so they are not
   swallowed as an application number. */
router.get("/loan-status", auth, requireCustomer, customerController.loanStatusByPan);
router.get("/summary", auth, requireCustomer, customerController.summary);

router.get("/loans/:applicationNo", auth, requireCustomer, customerController.loanDetail);

module.exports = router;
