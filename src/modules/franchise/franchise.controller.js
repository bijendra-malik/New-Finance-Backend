const franchiseService = require("./franchise.service");
const { FRANCHISE_STATUS } = require("../../constants/roles");
const { sanitizeFranchiseProfile } = require("./franchiseProfile");

/*
==========================================
Franchise endpoints.
==========================================
*/

/*
Franchise Login (FRN code + password)
POST /api/franchise/login
*/
exports.login = async (req, res, next) => {
  try {
    const { franchiseId, password } = req.body;

    const { token, franchise } = await franchiseService.loginFranchise(franchiseId, password);

    res.json({
      success: true,
      message: "Login successful",
      token,
      franchise,
    });
  } catch (error) {
    next(error);
  }
};

/*
Franchise Profile (registration data + application status)
GET /api/franchise/profile
*/
exports.profile = async (req, res, next) => {
  try {
    res.json({
      success: true,
      franchise: sanitizeFranchiseProfile(req.franchise),
      franchiseStatus: req.franchise?.franchiseStatus || null,
    });
  } catch (error) {
    next(error);
  }
};

/*
Franchise Application
POST /api/franchise/apply

Registration data (name/mobile/email/country/continent) is already on the
account, so this only collects the franchise-specific fields.
*/
exports.apply = async (req, res, next) => {
  try {
    const franchise = await franchiseService.applyFranchise(req.user.id, req.body);

    res.status(200).json({
      success: true,
      message: "Franchise application submitted. Please wait for admin approval.",
      franchiseStatus: franchise.franchiseStatus,
      franchise,
    });
  } catch (error) {
    next(error);
  }
};

/*
Franchise application status (for the pending screen)
GET /api/franchise/status
*/
exports.status = async (req, res, next) => {
  try {
    res.json({
      success: true,
      franchiseStatus: req.franchise?.franchiseStatus || FRANCHISE_STATUS.NONE,
      franchiseId: req.franchise?.franchiseId || null,
      updatedAt: req.franchise?.updatedAt || null,
    });
  } catch (error) {
    next(error);
  }
};

/*
Franchise Loan Apply (approved franchises only)
POST /api/franchise/loan-apply

Body: the selected product's normal apply payload, plus
  product   -> "personal" | "business" | "home" | ... (LOAN_PRODUCTS key)
  customerId (optional)  an already-registered customer
  mobile / fullName / email  (used when there is no customerId)
*/
exports.loanApply = async (req, res, next) => {
  try {
    const { application, product, customer } = await franchiseService.createFranchiseLoan(
      req.franchise,
      req.body
    );

    res.status(201).json({
      success: true,
      product,
      customerId: customer._id,
      franchiseId: req.franchise.franchiseId,
      data: application,
    });
  } catch (error) {
    next(error);
  }
};

/*
Loans submitted through this franchise, grouped per product
GET /api/franchise/loans
*/
exports.myLoans = async (req, res, next) => {
  try {
    const { total, data } = await franchiseService.listFranchiseLoans(req.franchise);

    res.json({
      success: true,
      franchiseId: req.franchise.franchiseId,
      total,
      data,
    });
  } catch (error) {
    next(error);
  }
};
