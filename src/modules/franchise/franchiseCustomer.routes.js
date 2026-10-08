const router = require("express").Router();

const controller = require("./franchiseCustomer.controller");
const auth = require("../../middleware/auth.middleware");
const { requireApprovedFranchise } = require("../../middleware/franchise.middleware");
const {
  franchiseCustomerValidator,
  franchiseCustomerUpdateValidator,
  cibilCheckValidator,
} = require("./franchiseCustomer.validator");

/*
========================================
Franchise customer API — mounted at /api/franchise/customer
(APPROVED franchise only, franchise token)

Ye flow franchise ke loan form ko lock/unlock karta hai:

  POST   /                basic details save        -> loan form LOCKED
  POST   /:id/cibil-check CIBIL score (consent)     -> unlock agar eligible
  GET    /:id/eligibility lock state (frontend gate)
  GET    /                apne customers (+ lock state + loan count)
  GET    /:id             ek customer ki poori detail
  PATCH  /:id             details update (PAN/DOB badle to dobara LOCKED)
  GET    /:id/loans       us customer ke saare loans + status/stage/timeline
  GET    /:id/loans/:applicationNo   ek loan ka status (LOAN000001)

Loan apply alag hai: POST /api/franchise/loan-apply (franchiseCustomerId ke
saath, aur sirf eligible customer par).
========================================
*/

router.post("/", auth, requireApprovedFranchise, franchiseCustomerValidator, controller.register);

router.get("/", auth, requireApprovedFranchise, controller.list);

router.get("/:id", auth, requireApprovedFranchise, controller.getOne);

router.patch("/:id", auth, requireApprovedFranchise, franchiseCustomerUpdateValidator, controller.update);

router.post("/:id/cibil-check", auth, requireApprovedFranchise, cibilCheckValidator, controller.cibilCheck);

router.get("/:id/eligibility", auth, requireApprovedFranchise, controller.eligibility);

// Customer ki loan tracking — franchise apne customer ka status dekhta hai
router.get("/:id/loans", auth, requireApprovedFranchise, controller.loans);

router.get("/:id/loans/:applicationNo", auth, requireApprovedFranchise, controller.loanDetail);

module.exports = router;
