const customerService = require("./customer.service");
const User = require("../auth/user.model");
const { applyCreditScore, creditStatus } = require("./credit.service");
const { ACCOUNT_NOT_FOUND_MESSAGE } = require("../auth/entryDetails");

/*
==========================================
Customer endpoints.
==========================================
*/

/*
Customer application status + existing application
GET /api/customer/loan-apply?product=personal

Existing application ho to uski compact details milti hain. Naya application
submit alag se POST /api/customer/loan-apply se hota hai.
*/
exports.loanApplyForm = async (req, res, next) => {
  try {
    const screen = await customerService.getLoanApplyScreen(req.user.id, {
      product: req.query.product ?? req.body?.product,
    });

    res.json({ success: true, ...screen });
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
    const { application, product } = await customerService.createCustomerLoan(req.user.id, req.body, req.account);

    res.status(201).json({
      success: true,
      message: "Loan application submitted successfully.",
      product,
      loanType: application.loanType,
      data: application,
    });
  } catch (error) {
    next(error);
  }
};

/*
Credit score submit — eligible (>= 650) hone par 24-hour apply window start.
POST /api/customer/credit-score   { creditScore }
*/
exports.checkCreditScore = async (req, res, next) => {
  try {
    const account = await User.findById(req.user.id);
    if (!account) {
      return res.status(401).json({ success: false, message: ACCOUNT_NOT_FOUND_MESSAGE });
    }

    const result = applyCreditScore(account, req.body.creditScore);
    await account.save();

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/*
Current credit-score status + remaining window (dashboard countdown ke liye).
GET /api/customer/credit-score
*/
exports.creditScoreStatus = async (req, res, next) => {
  try {
    const account = await User.findById(req.user.id);
    if (!account) {
      return res.status(401).json({ success: false, message: ACCOUNT_NOT_FOUND_MESSAGE });
    }

    res.json({ success: true, ...creditStatus(account) });
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
