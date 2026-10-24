const franchiseService = require("./franchise.service");
const entryService = require("../auth/entry.service");
const franchiseStatusService = require("./franchiseStatus.service");
const { FRANCHISE_STATUS, USER_ROLE } = require("../../constants/roles");
const { sanitizeFranchiseProfile } = require("./franchiseProfile");

/*
==========================================
Franchise endpoints.

Entry (franchise banna) aur login do alag cheezein hain:

  entry / entry-verify -> naya franchise account (franchiseStatus = None)
  login                -> APPROVED franchise ka dashboard (FRN + password)
==========================================
*/

/*
Franchise Entry — step 1
POST /api/franchise/entry

Basic details (name, email, mobile, dob, PAN, continent, country, city, pincode) + plan/package
+ business data — sab ek hi form me. Sab kuch PENDING rehta hai aur OTP chala
jaata hai; koi account nahi banta, isliye adhoora form chhodhne par kuch bachta
nahi.
*/
exports.entry = async (req, res, next) => {
  try {
    const { mobileMasked } = await entryService.startEntry({
      role: USER_ROLE.FRANCHISE,
      body: req.body,
    });

    res.status(200).json({
      success: true,
      message: `OTP sent to ${mobileMasked}`,
      mobileMasked,
      nextStep: "verify-otp",
    });
  } catch (error) {
    next(error);
  }
};

/*
Franchise Entry — step 2
POST /api/franchise/entry/verify

OTP match hone par franchise account banta hai, entry me bhara plan + business
data usi par utarta hai, aur franchiseStatus seedha **Pending** ho jaata hai —
alag se koi "apply" step nahi hai. Admin approve kare to FRN + password milte
hain, aur tab `/api/franchise/login` se dashboard khulta hai.
*/
exports.verifyEntry = async (req, res, next) => {
  try {
    const result = await entryService.verifyEntry({
      mobile: req.body.mobile,
      otp: req.body.otp,
      expectedRole: USER_ROLE.FRANCHISE,
    });

    res.json({
      success: true,
      message: "Mobile verified successfully",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

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
Franchise application status (pending / approved / rejected screen)
GET /api/franchise/status

Status screen par sirf itna aata hai: kitna hua, aur (reject hone par) admin ka
reason. **Login ID aur password yahan kabhi nahi aate** — approved hone par
franchise admin se mile FRN + password se `/api/franchise/login` karta hai.
*/
exports.status = async (req, res, next) => {
  try {
    const franchise = req.franchise || {};
    const franchiseStatus = franchise.franchiseStatus || FRANCHISE_STATUS.NONE;

    // Admin ne reject karte waqt jo note diya tha (admin/franchise.service.js).
    const adminNote = String(franchise.businessDetails?.adminNote || "").trim();

    const payload = {
      success: true,
      franchiseStatus,
      canLogin: franchiseStatus === FRANCHISE_STATUS.APPROVED,
      updatedAt: franchise.updatedAt || null,
    };

    if (franchiseStatus === FRANCHISE_STATUS.APPROVED) {
      payload.message =
        "Your franchise is approved. Please login with the franchise ID and password shared by the admin.";
      payload.approvedAt = franchise.franchiseApprovedAt || null;
    } else if (franchiseStatus === FRANCHISE_STATUS.PENDING) {
      payload.message = "Your franchise application is pending admin approval.";
      payload.appliedAt = franchise.franchiseAppliedAt || null;
    } else if (franchiseStatus === FRANCHISE_STATUS.REJECTED) {
      // Wajah yahin dikhti hai — isliye admin ko reject karte waqt note dena chahiye.
      payload.rejectionReason = adminNote;
      payload.rejectedAt = franchise.franchiseRejectedAt || null;
      payload.message = adminNote
        ? `Your franchise application was rejected. Reason: ${adminNote}`
        : "Your franchise application was rejected. Please contact support for the reason.";
    } else {
      payload.message = "Franchise application abhi submit nahi hui hai. Please fill the franchise form.";
    }

    res.json(payload);
  } catch (error) {
    next(error);
  }
};

/* Public status check: identity OTP request, then OTP verification. */
exports.requestStatusOtp = async (req, res, next) => {
  try {
    const result = await franchiseStatusService.requestStatusOtp(req.body ?? {});
    res.json({
      success: true,
      message: result.message,
      mobileMasked: result.mobileMasked,
      nextStep: "status",
    });
  } catch (error) {
    next(error);
  }
};

exports.publicStatus = async (req, res, next) => {
  try {
    const result = await franchiseStatusService.getStatus(req.body ?? {});
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/*
Franchise Loan Apply (approved franchises only)
POST /api/franchise/customer/:product/applyloan

`product` URL se aata hai (route par `productFromParam` use hota hai), body me
selected product ka normal apply payload + ye do cheezein bheji jaati hain:

  franchiseCustomerId -> POST /api/franchise/customer/register se bana customer

Applicant ke personal details (fullName, mobile, PAN, DOB, email) franchise
customer ke profile se aate hain — form inhe dobara nahi bhejta.
*/
exports.loanApply = async (req, res, next) => {
  try {
    const { draftId, createdAt, expiresAt, product, franchiseCustomer } =
      await franchiseService.createFranchiseLoanDraft(req.franchise, req.body);

    res.status(202).json({
      success: true,
      message: "Loan form saved temporarily. Submit the customer's credit score to complete the application.",
      product,
      nextStep: "credit-score",
      franchiseCustomerId: franchiseCustomer._id,
      draft: { draftId, product, createdAt, expiresAt },
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
