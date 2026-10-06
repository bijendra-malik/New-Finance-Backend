const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../auth/user.model");
const generateToken = require("../../utils/generateToken");
const { nextLoanApplicationNo } = require("../../utils/sequence");
const { MODELS } = require("../loans/shared/loanModels");
const { LOAN_PRODUCTS } = require("../loans/shared/loanProducts");
const { buildLoanDocument, sanitizeLoanResponse } = require("../loans/shared/loan.service");
const { USER_ROLE, FRANCHISE_STATUS } = require("../../constants/roles");

/*
==========================================
Franchise service.

A franchise account is created through the SAME /api/auth/register endpoint as
a customer (role = "Franchise"). Everything franchise-specific happens here:

  1. applyFranchise()      -> profile details, franchiseStatus = Pending
  2. loginFranchise()      -> FRN code + PAN password -> JWT
  3. createFranchiseLoan() -> approved franchise applies on behalf of a customer
  4. listFranchiseLoans()  -> all loans submitted through this FRN, grouped

The admin actions (approve / reject, which mint the FRN code) live in
modules/admin/franchise.service.js.
==========================================
*/

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

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

const notFound = (message) => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

/** Some clients wrap the payload in a `data` object (same rule as the loan service). */
const unwrap = (body) =>
  body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body || {};

const cleanText = (value) => String(value ?? "").trim();

/* ---------------------------------------------------------------- apply -- */

const applyFranchise = async (userId, body = {}) => {
  const payload = unwrap(body);

  const franchise = await User.findById(userId);
  if (!franchise) throw notFound("Franchise account not found");

  if (franchise.franchiseStatus === FRANCHISE_STATUS.APPROVED) {
    throw badRequest("Your franchise is already approved.");
  }

  const panNumber = cleanText(payload.panNumber).toUpperCase();
  if (!panNumber) throw badRequest("PAN number is required");
  if (!PAN_REGEX.test(panNumber)) throw badRequest("Enter a valid PAN number (e.g. ABCDE1234F)");

  const state = cleanText(payload.state);
  const city = cleanText(payload.city);
  const pkg = cleanText(payload.package);

  if (!state) throw badRequest("State is required");
  if (!city) throw badRequest("City is required");
  if (!pkg) throw badRequest("Package is required");

  // Optional business profile — stored as-is for the admin to review.
  const businessDetails = {
    businessName: cleanText(payload.businessName),
    businessType: cleanText(payload.businessType),
    gstNumber: cleanText(payload.gstNumber),
    address: cleanText(payload.address),
    yearsInBusiness: cleanText(payload.yearsInBusiness),
  };

  franchise.panNumber = panNumber;
  franchise.state = state;
  franchise.city = city;
  franchise.pincode = cleanText(payload.pincode);
  franchise.package = pkg;
  franchise.businessDetails = businessDetails;
  franchise.franchiseStatus = FRANCHISE_STATUS.PENDING;
  franchise.franchiseAppliedAt = new Date();
  franchise.franchiseRejectedAt = null;

  await franchise.save();

  return franchise;
};

/* ---------------------------------------------------------------- login -- */

/*
Franchise login is deliberate: FRN code + password (initially the PAN, hashed
by the admin on approval). Returns the same JWT shape as the customer login so
the rest of the API is unchanged.
*/
const loginFranchise = async (franchiseId, password) => {
  const code = cleanText(franchiseId).toUpperCase();
  if (!code) throw badRequest("Franchise ID is required");
  if (!password) throw badRequest("Password is required");

  const franchise = await User.findOne({ franchiseId: code }).select("+password");

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
 * Resolve the customer an application belongs to.
 *
 *  - `customerId` (an already-registered customer) is used as-is.
 *  - otherwise the customer is matched by mobile; a walk-in customer with a
 *    brand-new mobile gets a lightweight Customer account so `user` (and the
 *    "kitne loans apply kiye" report) always has an owner.
 */
const resolveCustomer = async (payload) => {
  const rawId = cleanText(payload.customerId);

  if (rawId) {
    if (!mongoose.isValidObjectId(rawId)) throw badRequest("Invalid customerId");
    const existing = await User.findById(rawId);
    if (!existing) throw notFound("Customer not found");
    if (existing.role === USER_ROLE.FRANCHISE) {
      throw badRequest("customerId must belong to a customer account");
    }
    return existing;
  }

  const mobile = cleanText(payload.mobile);
  if (!/^\d{10}$/.test(mobile)) throw badRequest("Applicant mobile (10 digits) is required");

  const existing = await User.findOne({ mobile });
  if (existing) {
    if (existing.role === USER_ROLE.FRANCHISE) {
      throw badRequest("This mobile belongs to a franchise account");
    }
    return existing;
  }

  const name = cleanText(payload.fullName);
  const email = cleanText(payload.email);
  if (!name) throw badRequest("Applicant full name is required for a new customer");
  if (!email) throw badRequest("Applicant email is required for a new customer");

  const emailTaken = await User.findOne({ email: email.toLowerCase() });
  if (emailTaken) throw badRequest("This email is already registered. Please pass customerId instead.");

  return User.create({
    name,
    mobile,
    email,
    role: USER_ROLE.CUSTOMER,
    isVerified: false,
  });
};

const createFranchiseLoan = async (franchise, body = {}) => {
  const payload = unwrap(body);

  const product = cleanText(payload.product);
  if (!LOAN_PRODUCTS[product] || !MODELS[product]) {
    throw badRequest("A valid loan product is required");
  }

  const customer = await resolveCustomer(payload);

  const applicationNo = await nextLoanApplicationNo();

  const document = buildLoanDocument(product, payload, customer._id, {
    franchise: franchise._id,
    franchiseCode: franchise.franchiseId,
    applicationNo,
  });

  const application = await MODELS[product].create(document);

  return { application: sanitizeLoanResponse(product, application), product, customer };
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
  applyFranchise,
  loginFranchise,
  createFranchiseLoan,
  listFranchiseLoans,
  PAN_REGEX,
};
