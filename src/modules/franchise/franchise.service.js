const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../auth/user.model");
const Franchise = require("./franchise.model");
const FranchiseCustomer = require("./franchiseCustomer.model");
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
  2. loginFranchise()      -> FRN code + password -> JWT
  3. createFranchiseLoan() -> approved franchise applies for its OWN customer
                             (customer register/read ka kaam
                              franchiseCustomer.service.js me hai)
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

  const franchise = await Franchise.findById(userId);
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
 * POST /api/franchise/customer/register se customer banao, phir uski `_id`
 * `franchiseCustomerId` ke roop me bhejo.
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

  return User.create({
    name: cleanText(franchiseCustomer.fullName),
    mobile,
    email: emailLower,
    role: USER_ROLE.CUSTOMER,
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

  const applicant = applicantFromCustomer(franchiseCustomer, payload);
  const customer = await resolveCustomerAccount(franchiseCustomer, applicant.email);

  const applicationNo = await nextLoanApplicationNo();

  const document = buildLoanDocument(product, { ...payload, ...applicant }, customer._id, {
    franchise: franchise._id,
    franchiseCode: franchise.franchiseId,
    franchiseCustomer: franchiseCustomer._id,
    applicationNo,
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
  applyFranchise,
  loginFranchise,
  createFranchiseLoan,
  listFranchiseLoans,
  PAN_REGEX,
};
