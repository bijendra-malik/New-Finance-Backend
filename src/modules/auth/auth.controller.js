const User = require("./user.model");
const Franchise = require("../franchise/franchise.model");
const entryService = require("./entry.service");
const { LOAN_PRODUCTS } = require("../loans/shared/loanProducts");
const { USER_ROLE } = require("../../constants/roles");
const {
  FRANCHISE_ONLY_PROFILE_FIELDS,
  sanitizeFranchiseProfile,
} = require("../franchise/franchiseProfile");

/*
==========================================
Auth controller.

Register / signup / login NAHI hai. Customer ke liye poora darwaza yahi hai:

  POST /api/auth/:product     step 1 — loan click: details pending + OTP
  POST /api/auth/verify-otp   step 2 — OTP match par account + CUST id + token

Uske baad wo token hi loan form (`POST /api/customer/loan-apply`) ke saath
jaata hai. Account/ID mint karne ka kaam entry.service.js me hai — yahan sirf
request/response handle hoti hai.

Franchise ka apna alag darwaza hai (POST /api/franchise/entry) aur uski apni
login hai (FRN + password) — wo franchise module me rehti hai.
==========================================
*/

/** Token ke role se sahi collection — customer `users`, franchise `franchises`. */
const modelForRole = (role) => (role === USER_ROLE.FRANCHISE ? Franchise : User);

/*
Step 1 — Loan entry (per-loan).
POST /api/auth/personal-loan  ·  /api/auth/gold-loan  ·  /api/auth/credit-card …

`product` URL se aata hai (route par `productFromParam`), aur usi se aage ka
loan form decide hota hai. Kuch save nahi hota — details OTP ke saath pending
rehti hain, taaki adhoora form chhodhne par koi half-filled customer record na
bane.
*/
exports.entry = async (req, res, next) => {
  try {
    const product = String(req.body.product || "").trim();
    const body = { ...req.body };
    delete body.city;
    delete body.pincode;

    const { mobile, mobileMasked } = await entryService.startEntry({
      role: USER_ROLE.CUSTOMER,
      product,
      body,
    });

    const config = LOAN_PRODUCTS[product];

    /*
    `mobile` poora number hai (verify-otp me yahi bhejna hota hai) aur
    `mobileMasked` screen par dikhane ke liye. Message hamesha masked rehta hai.
    */
    res.status(200).json({
      success: true,
      message: `OTP sent to ${mobileMasked}`,
      mobile,
      mobileMasked,
      product,
      loanType: config ? config.loanType : "",
      nextStep: "verify-otp",
    });
  } catch (error) {
    next(error);
  }
};

/*
Step 2 — OTP verify.
POST /api/auth/verify-otp

Yahin tay hota hai: mobile OTP match hua -> account (naya ya purana wahi),
CUST id mint, aur JWT. Token isi flow ke loan form me lagti hai.
*/
exports.verifyOTP = async (req, res, next) => {
  try {
    const result = await entryService.verifyEntry({
      mobile: req.body.mobile,
      otp: req.body.otp,
      expectedRole: USER_ROLE.CUSTOMER,
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
Customer login — Step 1.
POST /api/auth/login/request-otp   { mobile }

Sirf pehle se bane customer ka OTP. Naya account yahan nahi banta.
*/
exports.loginRequestOtp = async (req, res, next) => {
  try {
    const { mobileMasked } = await entryService.startLogin({ mobile: req.body.mobile });

    res.json({
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
Customer login — Step 2.
POST /api/auth/login/:product/verify-otp   { mobile, otp }

Login token product-locked nahi hota: customer credit score check karke koi bhi
loan product choose kar sakta hai.
*/
exports.loginVerify = async (req, res, next) => {
  try {
    const result = await entryService.verifyLogin({
      mobile: req.body.mobile,
      otp: req.body.otp,
      product: req.body.product,
    });

    res.json({
      success: true,
      message: "Login successful",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------- profiles -- */

// GET /api/auth/profile  (token ke role se sahi collection)
exports.profile = async (req, res, next) => {
  try {
    const Model = modelForRole(req.user?.role);
    const user = await Model.findById(req.user.id);

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

exports.customerProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const customer = user ? user.toObject() : null;

    if (customer) {
      /* Sirf franchise wale fields hatta hai — customer ke apne verified
         panNumber / dob / address profile me rehte hain. */
      FRANCHISE_ONLY_PROFILE_FIELDS.forEach((field) => delete customer[field]);
      if (customer.role === USER_ROLE.LEGACY_CUSTOMER) {
        customer.role = USER_ROLE.CUSTOMER;
      }
    }

    res.json({
      success: true,
      user: customer,
    });
  } catch (error) {
    next(error);
  }
};

exports.franchiseProfile = async (req, res, next) => {
  try {
    const franchise = await Franchise.findById(req.user.id);

    res.json({
      success: true,
      user: sanitizeFranchiseProfile(franchise),
    });
  } catch (error) {
    next(error);
  }
};
