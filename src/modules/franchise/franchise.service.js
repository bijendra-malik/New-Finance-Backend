const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");

const User = require("../auth/user.model");
const Franchise = require("./franchise.model");
const FranchiseCustomer = require("./franchiseCustomer.model");
const FranchiseCustomerLoanDraft = require("./franchiseCustomerLoanDraft.model");
const generateToken = require("../../utils/generateToken");
const { nextLoanApplicationNo, nextCustomerId } = require("../../utils/sequence");
const { MODELS } = require("../loans/shared/loanModels");
const { LOAN_PRODUCTS } = require("../loans/shared/loanProducts");
const { buildLoanDocument, sanitizeLoanResponse } = require("../loans/shared/loan.service");
const { assertLoanEligibility, creditSnapshot } = require("../customer/credit.service");
const { USER_ROLE, FRANCHISE_STATUS } = require("../../constants/roles");
const { MOBILE_PATTERN } = require("../loans/shared/helpers");

const FRANCHISE_CUSTOMER_DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;

/*
==========================================
Franchise service.

Franchise account mobile OTP verify hone par banta hai, aur usi waqt entry ka plan +
business data bhi utar jaata hai (POST /api/franchise/entry + /entry/verify —
engine auth/entry.service.js me hai). Alag "apply" step nahi hai.
Everything franchise-specific happens here:

  1. loginFranchise()      -> FRN code + password -> JWT
  2. createFranchiseLoanDraft() -> approved franchise saves its customer's form
  3. finalizeFranchiseCustomerLoanDraft() -> eligible score submits the loan
  4. listFranchiseLoans()        -> all loans submitted through this FRN, grouped

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

const conflict = (message) => {
  const error = new Error(message);
  error.statusCode = 409;
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
  if (!MOBILE_PATTERN.test(mobile)) {
    throw badRequest("Customer mobile must be a valid 10-digit number that does not start with 0");
  }

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
const createFranchiseLoanDraft = async (franchise, body = {}) => {
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
  await resolveCustomerAccount(franchiseCustomer, applicant.email);
  await FranchiseCustomerLoanDraft.ensureExpiryIndex();

  const existingDraft = await FranchiseCustomerLoanDraft.findOne({
    franchise: franchise._id,
    franchiseCustomer: franchiseCustomer._id,
  });
  if (existingDraft && new Date(existingDraft.expiresAt).getTime() > Date.now()) {
    throw conflict(
      "This customer already has an unfinished loan draft. Resume or cancel it before starting another loan."
    );
  }
  if (existingDraft) {
    await FranchiseCustomerLoanDraft.deleteOne({ _id: existingDraft._id });
  }

  const draft = await FranchiseCustomerLoanDraft.create({
    franchise: franchise._id,
    franchiseCustomer: franchiseCustomer._id,
    draftId: randomUUID(),
    product,
    payload: { ...payload, ...applicant },
    expiresAt: new Date(Date.now() + FRANCHISE_CUSTOMER_DRAFT_RETENTION_MS),
  });

  return {
    draftId: draft.draftId,
    createdAt: draft.createdAt,
    expiresAt: draft.expiresAt,
    product,
    franchiseCustomer,
  };
};

const requireActiveFranchiseCustomerLoanDraft = async (franchise, franchiseCustomer, draftId) => {
  await FranchiseCustomerLoanDraft.ensureExpiryIndex();
  const draft = await FranchiseCustomerLoanDraft.findOne({
    franchise: franchise._id,
    franchiseCustomer: franchiseCustomer._id,
    draftId,
    expiresAt: { $gt: new Date() },
  });

  if (!draft) {
    await FranchiseCustomerLoanDraft.deleteOne({
      franchise: franchise._id,
      franchiseCustomer: franchiseCustomer._id,
      draftId,
    });
    const error = new Error(
      "Loan form draft was not found or has expired. Please fill and submit the loan form again."
    );
    error.statusCode = 409;
    throw error;
  }

  return draft;
};

const getFranchiseCustomerLoanDraft = async (franchise, franchiseCustomer) => {
  await FranchiseCustomerLoanDraft.ensureExpiryIndex();
  const draft = await FranchiseCustomerLoanDraft.findOne({
    franchise: franchise._id,
    franchiseCustomer: franchiseCustomer._id,
  });
  if (!draft) return null;

  if (new Date(draft.expiresAt).getTime() <= Date.now()) {
    await FranchiseCustomerLoanDraft.deleteOne({
      _id: draft._id,
      franchise: franchise._id,
      franchiseCustomer: franchiseCustomer._id,
    });
    return null;
  }

  return draft;
};

const cancelFranchiseCustomerLoanDraft = async (franchise, franchiseCustomer) => {
  await FranchiseCustomerLoanDraft.ensureExpiryIndex();
  const result = await FranchiseCustomerLoanDraft.deleteOne({
    franchise: franchise._id,
    franchiseCustomer: franchiseCustomer._id,
  });
  return result.deletedCount > 0;
};

const finalizeFranchiseCustomerLoanDraft = async (franchise, franchiseCustomer, draft, customer) => {
  const product = cleanText(draft.product);
  if (!LOAN_PRODUCTS[product] || !MODELS[product]) throw badRequest("A valid loan product is required");

  assertLoanEligibility(customer);

  const applicationNo = await nextLoanApplicationNo();
  const applicant = applicantFromCustomer(franchiseCustomer, draft.payload);
  const document = buildLoanDocument(product, { ...draft.payload, ...applicant }, customer._id, {
    franchise: franchise._id,
    franchiseCode: franchise.franchiseId,
    franchiseCustomer: franchiseCustomer._id,
    applicationNo,
    credit: creditSnapshot(customer),
  });
  const application = await MODELS[product].create(document);
  await FranchiseCustomerLoanDraft.deleteOne({
    _id: draft._id,
    franchise: franchise._id,
    franchiseCustomer: franchiseCustomer._id,
    draftId: draft.draftId,
  });

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
  createFranchiseLoanDraft,
  requireActiveFranchiseCustomerLoanDraft,
  getFranchiseCustomerLoanDraft,
  cancelFranchiseCustomerLoanDraft,
  finalizeFranchiseCustomerLoanDraft,
  listFranchiseLoans,
};
