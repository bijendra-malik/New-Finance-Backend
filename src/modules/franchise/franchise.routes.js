const router = require("express").Router();

const franchiseController = require("./franchise.controller");
const auth = require("../../middleware/auth.middleware");
const {
  requireFranchise,
  loadFranchise,
  requireApprovedFranchise,
} = require("../../middleware/franchise.middleware");
const { adminLoginLimiter } = require("../../middleware/rateLimit.middleware");
const {
  franchiseLoginValidator,
  franchiseApplyValidator,
} = require("./franchise.validator");

/*
========================================
Franchise API — mounted at /api/franchise

  POST /login        franchiseId + password -> JWT          (public)
  GET  /profile      registration + status  (franchise token)
  POST /apply        franchise application  (franchise token)
  GET  /status       approval status        (franchise token)
  GET  /loans        loans via this FRN     (APPROVED franchise only)

Franchise ke apne CUSTOMERS aur unke loans alag router me hain:

  POST /customer/register                   customer save
  POST /customer/:product/applyloan         loan apply
  GET  /customer, /customer/:id, ...
  (poori list aur comments: franchiseCustomer.routes.js)
========================================
*/

// Public
router.post("/login", adminLoginLimiter, franchiseLoginValidator, franchiseController.login);

// Franchise ka apna customer — register + loan apply
router.use("/customer", require("./franchiseCustomer.routes"));

// Franchise (any approval status)
router.get("/profile", auth, requireFranchise, loadFranchise, franchiseController.profile);
router.get("/status", auth, requireFranchise, loadFranchise, franchiseController.status);
router.post("/apply", auth, requireFranchise, franchiseApplyValidator, franchiseController.apply);

// Approved franchise only
router.get("/loans", auth, requireApprovedFranchise, franchiseController.myLoans);

module.exports = router;
