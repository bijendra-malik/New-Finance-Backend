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

/* Return the logged-in customer's active draft, regardless of product. */
exports.getLoanDraft = async (req, res, next) => {
  try {
    const result = await customerService.getCustomerLoanDraft(req.user.id);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/*
Customer Loan Apply (unified — stores a temporary draft; product in body)
POST /api/customer/loan-apply
*/
exports.loanApply = async (req, res, next) => {
  try {
    const draft = await customerService.createCustomerLoanDraft(req.user.id, req.body, req.account);

    res.status(202).json({
      success: true,
      message: "Loan form saved temporarily. Submit your credit score to complete the application.",
      product: draft.product,
      nextStep: "credit-score",
      draft: {
        draftId: draft.draftId,
        expiresAt: draft.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* Cancel the logged-in customer's own pending loan-form draft. */
exports.cancelLoanDraft = async (req, res, next) => {
  try {
    const result = await customerService.cancelCustomerLoanDraft(req.user.id, req.body.draftId);
    res.json({
      success: true,
      message: "Loan form draft cancelled. You can now start another loan application.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

/*
Credit score submit — eligible score finalizes the pending draft.
POST /api/customer/credit-score   { draftId, creditScore }
*/
exports.checkCreditScore = async (req, res, next) => {
  try {
    const account = await User.findById(req.user.id);
    if (!account) {
      return res.status(401).json({ success: false, message: ACCOUNT_NOT_FOUND_MESSAGE });
    }

    const { draftId } = req.body;
    const draft = await customerService.getActiveCustomerLoanDraft(req.user.id, draftId);

    /*
    Koi active draft nahi (form bhara hi nahi, ya 24 ghante me expire ho gaya):

      - score >= 600 -> purana 409 wahi rehta hai, kuch save nahi hota;
      - score < 600  -> account par score save + ek credit-score rejection record
                        (admin ki Reject Loans list me dikhe). Loan application
                        nahi ban sakti kyunki koi form hi nahi tha.
    */
    if (!draft) {
      const preview = applyCreditScore(account, req.body.creditScore);

      if (preview.eligible) {
        return res.status(409).json({
          success: false,
          message:
            "Loan form draft was not found or has expired. Please submit the loan form again.",
        });
      }

      await account.save();
      await customerService.recordCreditScoreRejection(account, preview);

      return res.json({
        success: true,
        ...preview,
        rejected: true,
        draftRetained: false,
        product: null,
        applicationNo: null,
        nextStep: "credit-score",
      });
    }

    const result = applyCreditScore(account, req.body.creditScore);
    await account.save();

    if (!result.eligible) {
      /*
      Score < 600 — rejected application bhi DB me save hoti hai (status
      "Rejected" + reason), taaki admin ki Reject Loans list me dikhe.
      */
      const lowScore = await customerService.finalizeCustomerLoanDraft(req.user.id, draftId, account, {
        forcedReason: result.message,
      });

      return res.json({
        success: true,
        ...result,
        rejected: true,
        draftRetained: false,
        product: lowScore.product,
        applicationNo: lowScore.application?.applicationNo ?? null,
        nextStep: "credit-score",
      });
    }

    const outcome = await customerService.finalizeCustomerLoanDraft(req.user.id, draftId, account);

    /* Policy / company-type / salary-mode rejection — record save ho chuki hai. */
    if (outcome.rejected) {
      return res.json({
        success: true,
        ...result,
        eligible: false,
        rejected: true,
        message: outcome.reason,
        draftRetained: false,
        product: outcome.product,
        applicationNo: outcome.application?.applicationNo ?? null,
        nextStep: "credit-score",
      });
    }

    res.json({
      success: true,
      ...result,
      message: "You are eligible. Your loan application has been submitted successfully.",
      product: outcome.product,
      nextStep: "complete",
      application: outcome.application,
    });
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
