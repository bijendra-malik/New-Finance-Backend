const service = require("./franchiseCustomer.service");

/*
==========================================
Franchise customer controllers (approved franchise only).

  POST   /api/franchise/customer                step 1: basic details
  GET    /api/franchise/customer                apne customers (+ lock state)
  GET    /api/franchise/customer/:id            ek customer
  PATCH  /api/franchise/customer/:id            details update
  POST   /api/franchise/customer/:id/cibil-check   step 2: CIBIL check
  GET    /api/franchise/customer/:id/eligibility   lock state dekhne ke liye
  GET    /api/franchise/customer/:id/loans             us customer ke saare loans + status
  GET    /api/franchise/customer/:id/loans/:applicationNo   ek loan ka status/timeline
==========================================
*/

/* Step 1 — basic details. Loan form yahin se LOCKED milta hai. */
exports.register = async (req, res, next) => {
  try {
    const data = await service.registerCustomer(req.franchise, req.body);

    res.status(201).json({
      success: true,
      message: "Customer saved. Run the CIBIL check to unlock the loan form.",
      data,
    });
  } catch (error) {
    next(error);
  }
};

/* Saare customers — search + pagination + cibil status filter */
exports.list = async (req, res, next) => {
  try {
    const { search, page, limit, cibilStatus, locked } = req.query;
    const result = await service.listCustomers(req.franchise, { search, page, limit, cibilStatus, locked });

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

    res.json({
      success: true,
      message: data.loanForm.locked
        ? "Customer updated. Loan form is locked until a valid CIBIL check."
        : "Customer updated.",
      data,
    });
  } catch (error) {
    next(error);
  }
};

/* Step 2 — CIBIL check (consent mandatory). Iske baad hi form unlock hota hai. */
exports.cibilCheck = async (req, res, next) => {
  try {
    const data = await service.runCheck(req.franchise, req.params.id, req.body ?? {});

    res.json({
      success: true,
      message: data.loanForm.canApplyLoan
        ? "CIBIL check complete. Loan form is unlocked."
        : data.loanForm.reason,
      data,
    });
  } catch (error) {
    next(error);
  }
};

/* Sirf lock state — frontend isse form ka lock/unlock decide karta hai. */
exports.eligibility = async (req, res, next) => {
  try {
    const data = await service.getEligibility(req.franchise, req.params.id);

    res.json({ success: true, ...data });
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
