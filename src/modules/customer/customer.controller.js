const customerService = require("./customer.service");
const User = require("../auth/user.model");

/*
==========================================
Customer endpoints.
==========================================
*/

/*
Step 1 of the loan flow — "Apply register"
POST /api/customer/apply-register

The customer clicked a loan product and this form collects the two basic
details at once: date of birth + PAN. The name comes from their registered
account, identified by the authenticated token.

  { "product": "personal", "dob": "1995-05-15", "panNumber": "ABCDE1234F" }

It only VALIDATES (product valid, PAN format, 18+ age) — nothing is stored
yet, so an abandoned form leaves no half application behind. On success the
client opens the full loan form and submits it to /api/customer/loan-apply
with these same dob + panNumber included.
*/
exports.applyRegister = async (req, res, next) => {
  try {
    const customer = await User.findById(req.user.id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer account not found",
      });
    }

    const result = customerService.validateApplyRegistration(req.body, customer.name);

    res.json({
      success: true,
      nextStep: "loan-apply",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

/*
Customer Loan Apply (unified — product in body)
POST /api/customer/loan-apply
*/
exports.loanApply = async (req, res, next) => {
  try {
    const { application, product } = await customerService.createCustomerLoan(req.user.id, req.body);

    res.status(201).json({
      success: true,
      product,
      data: application,
    });
  } catch (error) {
    next(error);
  }
};

/*
All applications of the logged-in customer, grouped per product
GET /api/customer/loans?status=Approved
*/
exports.loans = async (req, res, next) => {
  try {
    const { total, data } = await customerService.listCustomerLoans(req.user.id, {
      status: req.query.status,
    });

    res.json({
      success: true,
      userId: req.user.id,
      total,
      data,
    });
  } catch (error) {
    next(error);
  }
};

/*
One application's status/stage (LOAN000001)
GET /api/customer/loans/:applicationNo
*/
exports.loanDetail = async (req, res, next) => {
  try {
    const application = await customerService.getCustomerLoanDetail(req.user.id, req.params.applicationNo);

    res.json({ success: true, application });
  } catch (error) {
    next(error);
  }
};

/*
Track my applications by PAN
GET /api/customer/loan-status?panNumber=ABCDE1234F
*/
exports.loanStatusByPan = async (req, res, next) => {
  try {
    const result = await customerService.getCustomerLoansByPan(
      req.user.id,
      req.query.panNumber ?? req.body?.panNumber
    );

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/*
Dashboard summary — totals + counts by status + recent applications
GET /api/customer/summary
*/
exports.summary = async (req, res, next) => {
  try {
    const summary = await customerService.getCustomerSummary(req.user.id);

    res.json({ success: true, userId: req.user.id, ...summary });
  } catch (error) {
    next(error);
  }
};
