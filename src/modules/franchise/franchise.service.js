const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../auth/user.model");
const Franchise = require("./franchise.model");
const FranchiseCustomer = require("./franchiseCustomer.model");
const generateToken = require("../../utils/generateToken");
const { nextLoanApplicationNo, nextCustomerId } = require("../../utils/sequence");
const { MODELS } = require("../loans/shared/loanModels");
const { LOAN_PRODUCTS } = require("../loans/shared/loanProducts");
const { buildLoanDocument, sanitizeLoanResponse } = require("../loans/shared/loan.service");
const { assertLoanEligibility, creditSnapshot } = require("../customer/credit.service");
const { USER_ROLE, FRANCHISE_STATUS } = require("../../constants/roles");

/*
==========================================
Franchise service.

Franchise account mobile OTP verify hone par banta hai, aur usi waqt entry ka plan +
business data bhi utar jaata hai (POST /api/franchise/entry + /entry/verify —
engine auth/entry.service.js me hai). Alag "apply" step nahi hai.
Everything franchise-specific happens here:

  1. loginFranchise()      -> FRN code + password -> JWT
  2. createFranchiseLoan() -> approved franchise applies for its OWN customer
                             (customer register/read ka kaam
                              franchiseCustomer.service.js me hai)
  4. listFranchiseLoans()  -> all loans submitted through this FRN, grouped

The admin actions (approve / reject, which mint the FRN code) live in
modules/admin/franchise.service.js.
==========================================
*/

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const unauthorized = (message) => {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
};

const forbidden = (message) => {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
};

const notFound = (message) => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

/** Some clients wrap the payload in a `data` object (same rule as the loan service). */
const unwrap = (body) =>
  body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body || {};

const cleanText = (value) => String(value ?? "").trim();

/* ---------------------------------------------------------------- login -- */

/*
Franchise login is deliberate: FRN code + password (initially the PAN number,
hashed by the admin on approval). Returns the same JWT shape as the customer
login so the rest of the API is unchanged.
*/
const loginFranchise = async (franchiseId, password) => {
  const code = cleanText(franchiseId).toUpperCase();
  if (!code) throw badRequest("Franchise ID is required");
  if (!password) throw badRequest("Password is required");

  const franchise = await Franchise.findOne({ franchiseId: code }).select("+password");

  if (!franchise) throw unauthorized("Invalid franchise ID or password");
  if (franchise.role !== USER_ROLE.FRANCHISE) throw unauthorized("Invalid franchise ID or password");

  if (franchise.franchiseStatus !== FRANCHISE_STATUS.APPROVED) {
    throw unauthorized("Your franchise is not approved yet.");
  }

  if (!franchise.password) throw unauthorized("Password not set. Please contact support.");

  const isMatch = await bcrypt.compare(String(password), franchise.password);
  if (!isMatch) throw unauthorized("Invalid franchise ID or password");

  franchise.lastLogin = new Date();
  await franchise.save();

  const token = generateToken(franchise);

  const safe = franchise.toObject();
  delete safe.password;

  return { token, franchise: safe };
};

/* ------------------------------------------------------- loan application -- */

/**
 * Franchise ka apna customer (franchisecustomers collection) — franchise-scoped.
 *
 * Loan apply ka pehla requirement yahi doc hai: pehle
 * POST /api/franchise/customer/register se customer banao, phir
 * POST /api/franchise/customer/verify-otp se uska mobile verify karo, aur tab
 * uski `_id` `franchiseCustomerId` ke roop me bhejo.
 */
const loadFranchiseCustomer = async (franchise, rawId) => {
  const id = cleanText(rawId);

  if (!id) {
    throw badRequest(
      "franchiseCustomerId is required. Register the customer at POST /api/franchise/customer/register first."
    );
  }
  if (!mongoose.isValidObjectId(id)) throw badRequest("Invalid franchiseCustomerId");

  // Franchise-scoped: dusri franchise ka customer yahan nahi milega.
  const franchiseCustomer = await FranchiseCustomer.findOne({ _id: id, franchise: franchise._id });
  if (!franchiseCustomer) throw notFound("Customer not found");

  return franchiseCustomer;
};

/** Franchise customer ke apne details — form inhi se pre-filled chalta hai. */
const applicantFromCustomer = (franchiseCustomer, payload) => {
  const dob = franchiseCustomer.dob ? new Date(franchiseCustomer.dob).toISOString().slice(0, 10) : "";

  const details = {
    fullName: cleanText(franchiseCustomer.fullName),
    mobile: cleanText(franchiseCustomer.mobile),
    panNumber: cleanText(franchiseCustomer.panNumber).toUpperCase(),
    dob,
    // Customer profile ka email pehle, warna form ka.
    email: cleanText(franchiseCustomer.email).toLowerCase() || cleanText(payload.email).toLowerCase(),
  };

  // Address details form me khaali chhoot gayi hon to profile se bhar do.
  ["state", "city", "pincode"].forEach((field) => {
    if (!cleanText(payload[field]) && cleanText(franchiseCustomer[field])) {
      details[field] = cleanText(franchiseCustomer[field]);
    }
  });

  return details;
};

/**
 * Loan ka owner account (`users` collection).
 *
 * Franchise customer ke mobile se match hota hai; na mile to ek lightweight
 * Customer account ban jaata hai, taaki `user` (aur "kitne loans apply kiye"
 * report) ka owner hamesha ho.
 */
const resolveCustomerAccount = async (franchiseCustomer, email) => {
  const mobile = cleanText(franchiseCustomer.mobile);
  if (!/^\d{10}$/.test(mobile)) throw badRequest("Customer mobile (10 digits) is required");

  const existing = await User.findOne({ mobile });
  if (existing) {
    if (existing.role === USER_ROLE.FRANCHISE) {
      throw badRequest("This mobile belongs to a franchise account");
    }
    return existing;
  }

  const emailLower = cleanText(email).toLowerCase();
  if (!emailLower) {
    throw badRequest(
      "Customer email is required to create the loan owner account. Please add the email to the customer first."
    );
  }

  const emailTaken = await User.findOne({ email: emailLower });
  if (emailTaken) throw badRequest("This email is already registered. Please update the customer email first.");

  /*
  Franchise ke customer ka apna account — CUST id yahan bhi mint hoti hai,
  warna uske naam par gaya loan status me dhoondha hi na jaata (status ka pehla
  door CUST id hi hai). isVerified false rehta hai: OTP customer ne khud verify
  nahi kiya, details franchise ne bhari hain.
  */
  return User.create({
    name: cleanText(franchiseCustomer.fullName),
    mobile,
    email: emailLower,
    role: USER_ROLE.CUSTOMER,
    customerId: await nextCustomerId(),
    isVerified: false,
  });
};

/*
Franchise loan apply:

  product               -> LOAN_PRODUCTS key (URL se `/:product/applyloan`)
  franchiseCustomerId   -> franchise ka apna customer (required)
  personal details      -> customer profile se aate hain (form inhe duplicate nahi karta)

Product-specific fields (loanAmount, employmentType, companyName ...) normal
apply payload ki tarah bheje jaate hain; validation route par usi product ke
rules se hoti hai.
*/
const createFranchiseLoan = async (franchise, body = {}) => {
  const payload = unwrap(body);

  const product = cleanText(payload.product);
  if (!LOAN_PRODUCTS[product] || !MODELS[product]) {
    throw badRequest("A valid loan product is required");
  }

  const franchiseCustomer = await loadFranchiseCustomer(franchise, payload.franchiseCustomerId);

  /*
  Customer ka mobile verify hona zaroori hai: OTP ka matlab hai ki customer ne
  khud apne loan ke liye haan kahi. Iske bina loan file nahi hoga.
  */
  if (!franchiseCustomer.isVerified) {
    throw forbidden(
      "This customer's mobile is not verified yet. Send the OTP and verify the customer before applying for a loan."
    );
  }

  const applicant = applicantFromCustomer(franchiseCustomer, payload);
  const customer = await resolveCustomerAccount(franchiseCustomer, applicant.email);

  // Franchise applications use the same 600+ score and 24-hour eligibility gate
  // as direct applications, and persist the customer's current score snapshot.
  assertLoanEligibility(customer);

  const applicationNo = await nextLoanApplicationNo();

  const document = buildLoanDocument(product, { ...payload, ...applicant }, customer._id, {
    franchise: franchise._id,
    franchiseCode: franchise.franchiseId,
    franchiseCustomer: franchiseCustomer._id,
    applicationNo,
    credit: creditSnapshot(customer),
  });

  const application = await MODELS[product].create(document);

  return {
    application: sanitizeLoanResponse(product, application),
    product,
    customer,
    franchiseCustomer,
  };
};

/* ----------------------------------------------------------------- list -- */

/** All applications submitted through this franchise, grouped per product. */
const listFranchiseLoans = async (franchise) => {
  const groups = await Promise.all(
    Object.entries(MODELS).map(async ([productKey, Model]) => {
      const applications = await Model.find({ franchise: franchise._id }).sort({ createdAt: -1 });
      if (!applications.length) return null;
      return {
        product: productKey,
        count: applications.length,
        applications: applications.map((application) => sanitizeLoanResponse(productKey, application)),
      };
    })
  );

  const data = groups.filter(Boolean);
  const total = data.reduce((sum, group) => sum + group.count, 0);

  return { total, data };
};

module.exports = {
  loginFranchise,
  createFranchiseLoan,
  listFranchiseLoans,
};
