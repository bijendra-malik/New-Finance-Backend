const router = require("express").Router();

const franchiseController = require("./franchise.controller");
const auth = require("../../middleware/auth.middleware");
const {
  requireFranchise,
  loadFranchise,
  requireApprovedFranchise,
} = require("../../middleware/franchise.middleware");
const normalizeApplyPayload = require("../../middleware/normalizeApplyPayload.middleware");
const { productFromParam } = require("../loans/shared/productApplyValidator");
const { adminLoginLimiter } = require("../../middleware/rateLimit.middleware");
const {
  franchiseLoginValidator,
  franchiseApplyValidator,
  franchiseLoanApplyValidator,
} = require("./franchise.validator");

/*
========================================
Franchise API — mounted at /api/franchise

  POST /login        franchiseId + password -> JWT          (public)
  GET  /profile      registration + status  (franchise token)
  POST /apply        franchise application  (franchise token)
  GET  /status       approval status        (franchise token)
  POST /loan-apply   apply for a customer   (APPROVED franchise only)
                     product in the BODY
  POST /loan-apply/:product
                     same, product in the PATH
                     e.g. /loan-apply/personalloan, /loan-apply/gold-loan
  GET  /loans        loans via this FRN     (APPROVED franchise only)
========================================
*/

// Public
router.post("/login", adminLoginLimiter, franchiseLoginValidator, franchiseController.login);

// Franchise (any approval status)
router.get("/profile", auth, requireFranchise, loadFranchise, franchiseController.profile);
router.get("/status", auth, requireFranchise, loadFranchise, franchiseController.status);
router.post("/apply", auth, requireFranchise, franchiseApplyValidator, franchiseController.apply);

// Approved franchise only
// Product in the body:  { "product": "personal", ... }
router.post(
  "/loan-apply",
  auth,
  requireApprovedFranchise,
  normalizeApplyPayload,
  franchiseLoanApplyValidator,
  franchiseController.loanApply
);

// Product in the path:  POST /loan-apply/personalloan
// (`productFromParam` pins :product onto the body, then the same product
// validator + controller run, so both entry points behave identically.)
router.post(
  "/loan-apply/:product",
  auth,
  requireApprovedFranchise,
  normalizeApplyPayload,
  productFromParam,
  franchiseLoanApplyValidator,
  franchiseController.loanApply
);

router.get("/loans", auth, requireApprovedFranchise, franchiseController.myLoans);

module.exports = router;
