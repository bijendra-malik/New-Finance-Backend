const service = require("./franchiseCustomer.service");

/*
==========================================
Franchise customer controllers (approved franchise only).

  POST   /api/franchise/customer/register            naya customer (+ OTP)
  POST   /api/franchise/customer/verify-otp          customer ka OTP -> CUST id
  GET    /api/franchise/customer/:id/draft           pending form resume karein
  DELETE /api/franchise/customer/:id/draft           pending form cancel karein
  GET    /api/franchise/customer                    apne customers (+ pagination)
  GET    /api/franchise/customer/:id                ek customer
  PATCH  /api/franchise/customer/:id                details update
  GET    /api/franchise/customer/:id/loans          us customer ke saare loans + status
  GET    /api/franchise/customer/:id/loans/:applicationNo   ek loan ka status/timeline

Loan apply isi router me hai (`/:product/applyloan`), par uska handler
franchise.controller.js me hai — form pehle draft banta hai, credit-score par
eligible hone ke baad actual loan save hota hai.
==========================================
*/

/*
Naya customer register — details loan application ka base banti hain, aur
customer ke phone par OTP chala jaata hai.
*/
exports.register = async (req, res, next) => {
  try {
    const data = await service.registerCustomer(req.franchise, req.body);

    res.status(201).json({
      success: true,
      message: `Customer saved. An OTP has been sent to the customer's mobile (${data.mobile}) for verification.`,
      nextStep: "verify-otp",
      data,
    });
  } catch (error) {
    next(error);
  }
};

/*
Customer ka OTP verify — customer ke registered mobile number se, bina customer ID ke.
POST /api/franchise/customer/verify-otp   { mobile, otp }
*/
exports.verifyCustomerOtp = async (req, res, next) => {
  try {
    const result = await service.verifyCustomerOtp(req.franchise, req.body);

    res.json({
      success: true,
      message: "Customer mobile verified successfully.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

exports.resendCustomerOtp = async (req, res, next) => {
  try {
    const result = await service.resendCustomerOtp(req.franchise, req.body);

    res.json({
      success: true,
      message: `A new OTP has been sent to ${result.mobileMasked}.`,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

exports.submitCustomerCreditScore = async (req, res, next) => {
  try {
    const result = await service.submitCustomerCreditScore(
      req.franchise,
      req.params.id,
      req.body.draftId,
      req.body.creditScore
    );

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.getDraft = async (req, res, next) => {
  try {
    const result = await service.getCustomerLoanDraft(req.franchise, req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.cancelDraft = async (req, res, next) => {
  try {
    const result = await service.cancelCustomerLoanDraft(req.franchise, req.params.id);
    res.json({
      success: true,
      message: "Pending loan draft cancelled. You can now start another loan application.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

/* Saare customers — search + pagination */
exports.list = async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;
    const result = await service.listCustomers(req.franchise, { search, page, limit });

    res.json({
      success: true,
      franchiseId: req.franchise.franchiseId,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const data = await service.getCustomer(req.franchise, req.params.id);

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    const data = await service.updateCustomer(req.franchise, req.params.id, req.body);

    res.json({ success: true, message: "Customer updated.", data });
  } catch (error) {
    next(error);
  }
};

/*
Us customer ke saare applications — product-wise grouped, aur har ek me wahi
status/stage/timeline jo customer ko dikhta hai (Submitted -> Under Review ->
Approved/Rejected).
*/
exports.loans = async (req, res, next) => {
  try {
    const result = await service.listCustomerLoans(req.franchise, req.params.id);

    res.json({ success: true, franchiseId: req.franchise.franchiseId, ...result });
  } catch (error) {
    next(error);
  }
};

/* Ek application ka status — LOAN000001 */
exports.loanDetail = async (req, res, next) => {
  try {
    const result = await service.getCustomerLoan(req.franchise, req.params.id, req.params.applicationNo);

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};
