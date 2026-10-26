const mongoose = require("mongoose");

const FranchiseCustomer = require("./franchiseCustomer.model");
const Franchise = require("./franchise.model");
const User = require("../auth/user.model");
const { MODELS } = require("../loans/shared/loanModels");
const { buildStatusView } = require("../customer/customer.service");
const { applyCreditScore } = require("../customer/credit.service");
const entryService = require("../auth/entry.service");
const franchiseService = require("./franchise.service");
const { USER_ROLE } = require("../../constants/roles");
const { MOBILE_PATTERN } = require("../loans/shared/helpers");

/*
==========================================
Franchise customer service.

Franchise flow ke do kaam:

  1. Customer register karna — registerCustomer() basic details save karti hai,
     listCustomers() / getCustomer() unhe padhti hain aur updateCustomer()
     details badalti hai.
  2. Un customers ke loans dekhna — listCustomerLoans() aur getCustomerLoan()
     wahi status/stage/timeline dete hain jo customer apne dashboard par dekhta
     hai (Submitted -> Under Review -> Approved/Rejected).

Har query `franchise: <id>` par scoped hai — koi franchise doosri ka customer
padh ya use nahi kar sakti.
==========================================
*/

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const conflict = (message) => {
  const error = new Error(message);
  error.statusCode = 409;
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

const unwrap = (body) =>
  body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body || {};

const cleanText = (value) => String(value ?? "").trim();

/** Customer doc ka public shape — mongoose internals hata kar plain object. */
const serializeCustomer = (customer) => {
  const data = typeof customer.toObject === "function" ? customer.toObject() : { ...customer };
  return { ...data };
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------------------------------------------------------- create -- */

const registerCustomer = async (franchise, body = {}) => {
  const payload = unwrap(body);

  const fullName = cleanText(payload.fullName);
  const mobile = cleanText(payload.mobile);
  const panNumber = cleanText(payload.panNumber).toUpperCase();
  const dob = cleanText(payload.dob);
  const email = cleanText(payload.email).toLowerCase();

  if (!fullName) throw badRequest("Customer full name is required");
  if (!MOBILE_PATTERN.test(mobile)) {
    throw badRequest("Enter a valid 10-digit mobile number");
  }
  if (!panNumber || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) {
    throw badRequest("Enter a valid PAN number (e.g. ABCDE1234F)");
  }

  const birthDate = new Date(dob);
  if (!dob || Number.isNaN(birthDate.getTime())) {
    throw badRequest("Enter a valid date of birth (YYYY-MM-DD)");
  }

  /*
  Email zaroori hai: verify hone par customer ke liye `users` account banta hai
  aur us model me email required hai (aur unique bhi).
  */
  if (!email) {
    throw badRequest("Customer email is required so the loan account can be created.");
  }

  // Franchise apne khud ke mobile par customer register na kar sake.
  const franchiseAccount = await Franchise.findOne({ mobile });
  if (franchiseAccount) {
    throw badRequest("This mobile belongs to a franchise account");
  }

  const existing = await FranchiseCustomer.findOne({ franchise: franchise._id, mobile });
  if (existing) {
    throw conflict("This customer is already registered by your franchise. Open the existing customer instead.");
  }

  const customer = await FranchiseCustomer.create({
    franchise: franchise._id,
    franchiseCode: franchise.franchiseId || null,
    fullName,
    mobile,
    panNumber,
    dob: birthDate,
    email,
    state: cleanText(payload.state),
    city: cleanText(payload.city),
    pincode: cleanText(payload.pincode),
  });

  /*
  Customer ke phone par OTP — engine wahi hai jo normal customer entry chalata
  hai (auth/entry.service.js). Yahan account NAHI banta: details pending rehti
  hain, aur CUST id OTP verify hone par hi banti hai.
  */
  await entryService.startEntry({
    role: USER_ROLE.CUSTOMER,
    body: {
      name: fullName,
      email,
      mobile,
      dob,
      panNumber,
      // Franchise customer ke record me continent/country nahi hote.
      continent: "",
      country: "",
    },
    franchise,
    franchiseCustomer: customer,
  });

  return serializeCustomer(customer);
};

/*
Customer ka OTP verify — yahin uske `users` account aur CUST id banti hai.
Token franchise ko nahi di jaati (uske paas apni franchise token already hai).
*/
const verifyCustomerOtp = async (franchise, body = {}) => {
  const payload = unwrap(body);
  const mobile = cleanText(payload.mobile);
  const customer = await FranchiseCustomer.findOne({ mobile, franchise: franchise._id });

  if (!customer) throw notFound("Customer not found for this mobile number");

  if (customer.isVerified) {
    throw conflict("This customer's mobile is already verified.");
  }

  const result = await entryService.verifyEntry({
    mobile: customer.mobile,
    otp: payload.otp,
    expectedRole: USER_ROLE.CUSTOMER,
    // OTP sirf isi franchise ke isi customer ka chalta hai.
    expectedFranchiseCustomerId: customer._id,
    issueToken: false,
  });

  customer.isVerified = true;
  customer.verifiedAt = new Date();
  await customer.save();

  return {
    customer: serializeCustomer(customer),
    customerId: result.customerId,
    nextStep: "loan-apply",
  };
};

const resendCustomerOtp = async (franchise, body = {}) => {
  const payload = unwrap(body);
  const customer = await getCustomerDoc(franchise, payload.franchiseCustomerId);

  if (customer.isVerified) {
    throw conflict("This customer's mobile is already verified.");
  }

  const result = await entryService.startEntry({
    role: USER_ROLE.CUSTOMER,
    body: {
      name: customer.fullName,
      email: customer.email,
      mobile: customer.mobile,
      dob: customer.dob,
      panNumber: customer.panNumber,
      continent: "",
      country: "",
    },
    franchise,
    franchiseCustomer: customer,
  });

  return { mobileMasked: result.mobileMasked, nextStep: "verify-otp" };
};

/** Franchise submits a credit score for its own OTP-verified customer. */
const submitCustomerCreditScore = async (franchise, id, draftId, rawScore) => {
  const franchiseCustomer = await getCustomerDoc(franchise, id);

  if (!franchiseCustomer.isVerified) {
    throw forbidden("Verify this customer's mobile before submitting a credit score.");
  }

  const draft = await franchiseService.requireActiveFranchiseCustomerLoanDraft(
    franchise,
    franchiseCustomer,
    draftId
  );
  const account = await User.findOne({ mobile: franchiseCustomer.mobile, role: USER_ROLE.CUSTOMER });
  if (!account) throw notFound("Customer account not found. Verify the customer's mobile first.");

  const result = applyCreditScore(account, rawScore);
  await account.save();

  if (!result.eligible) {
    /*
    Score < 600 — rejected application bhi DB me save hoti hai (status
    "Rejected" + reason), taaki admin ki Reject Loans list me dikhe.
    */
    const lowScore = await franchiseService.finalizeFranchiseCustomerLoanDraft(
      franchise,
      franchiseCustomer,
      draft,
      account,
      { forcedReason: result.message }
    );

    return {
      ...result,
      rejected: true,
      draftRetained: false,
      product: lowScore.product,
      applicationNo: lowScore.application?.applicationNo ?? null,
      nextStep: "credit-score",
    };
  }

  const finalized = await franchiseService.finalizeFranchiseCustomerLoanDraft(
    franchise,
    franchiseCustomer,
    draft,
    account
  );

  /* Policy / company-type / salary-mode rejection — record save ho chuki hai. */
  if (finalized.rejected) {
    return {
      ...result,
      eligible: false,
      rejected: true,
      message: finalized.reason,
      draftRetained: false,
      product: finalized.product,
      applicationNo: finalized.application?.applicationNo ?? null,
      nextStep: "credit-score",
    };
  }

  return {
    ...result,
    message: "You are eligible. Your loan application has been submitted successfully.",
    product: finalized.product,
    nextStep: "complete",
    application: finalized.application,
  };
};

const getCustomerLoanDraft = async (franchise, id) => {
  const customer = await getCustomerDoc(franchise, id);
  if (!customer.isVerified) throw forbidden("Verify this customer's mobile before continuing.");

  const draft = await franchiseService.getFranchiseCustomerLoanDraft(franchise, customer);
  if (!draft) {
    return { hasPendingDraft: false, nextStep: "loan-apply", draft: null };
  }

  return {
    hasPendingDraft: true,
    nextStep: "credit-score",
    draft: {
      draftId: draft.draftId,
      product: draft.product,
      data: draft.payload,
      createdAt: draft.createdAt,
      expiresAt: draft.expiresAt,
      updatedAt: draft.updatedAt,
    },
  };
};

const cancelCustomerLoanDraft = async (franchise, id) => {
  const customer = await getCustomerDoc(franchise, id);
  const cancelled = await franchiseService.cancelFranchiseCustomerLoanDraft(franchise, customer);
  if (!cancelled) throw notFound("No pending loan draft was found for this customer.");

  return { franchiseCustomerId: customer._id };
};

/* --------------------------------------------------------------- read -- */

const getCustomerDoc = async (franchise, id) => {
  if (!mongoose.isValidObjectId(id)) throw notFound("Customer not found");

  // Franchise-scoped: doosri franchise ka customer 404 hi deta hai.
  const customer = await FranchiseCustomer.findOne({ _id: id, franchise: franchise._id });
  if (!customer) throw notFound("Customer not found");

  return customer;
};

const getCustomer = async (franchise, id) => serializeCustomer(await getCustomerDoc(franchise, id));

/*
Saare customers — search + pagination.

`page`/`limit` DB level par lagte hain aur `total` ek alag countDocuments se
aata hai, isliye page 2 ka response sahi `total`/`totalPages` deta hai (sirf
current page ki length nahi).
*/
const listCustomers = async (franchise, { search, page, limit } = {}) => {
  const filter = { franchise: franchise._id };

  const q = cleanText(search);
  if (q) {
    const regex = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ fullName: regex }, { mobile: regex }, { panNumber: regex }, { email: regex }];
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 0, 0), 100) || 0;
  const pageNumber = Math.max(Number(page) || 1, 1);

  const query = FranchiseCustomer.find(filter).sort({ createdAt: -1 });
  if (safeLimit > 0) query.skip((pageNumber - 1) * safeLimit).limit(safeLimit);

  const [docs, total] = await Promise.all([query, FranchiseCustomer.countDocuments(filter)]);
  const data = await attachLoanCounts(franchise, docs.map(serializeCustomer));

  return {
    total,
    page: pageNumber,
    limit: safeLimit,
    totalPages: safeLimit > 0 ? Math.max(1, Math.ceil(total / safeLimit)) : 1,
    data,
  };
};

/* ------------------------------------------------------------- update -- */

const updateCustomer = async (franchise, id, body = {}) => {
  const payload = unwrap(body);
  const customer = await getCustomerDoc(franchise, id);

  if (payload.fullName !== undefined) customer.fullName = cleanText(payload.fullName);
  if (payload.mobile !== undefined) customer.mobile = cleanText(payload.mobile);
  if (payload.panNumber !== undefined) customer.panNumber = cleanText(payload.panNumber).toUpperCase();
  if (payload.dob !== undefined) customer.dob = new Date(cleanText(payload.dob));
  if (payload.email !== undefined) customer.email = cleanText(payload.email).toLowerCase();
  if (payload.state !== undefined) customer.state = cleanText(payload.state);
  if (payload.city !== undefined) customer.city = cleanText(payload.city);
  if (payload.pincode !== undefined) customer.pincode = cleanText(payload.pincode);

  await customer.save();

  return serializeCustomer(customer);
};

/* ------------------------------------------------------------- loans -- */

/**
 * Har customer ke saath loan count + last apply date (ek pass me, product-wise
 * aggregate) — franchise list me ye column dikh sakta hai.
 */
const attachLoanCounts = async (franchise, customers) => {
  if (!customers.length) return customers;

  const rows = await Promise.all(
    Object.values(MODELS).map((Model) =>
      Model.aggregate([
        { $match: { franchise: franchise._id } },
        {
          $group: {
            _id: "$franchiseCustomer",
            count: { $sum: 1 },
            lastAppliedAt: { $max: "$createdAt" },
          },
        },
      ])
    )
  );

  const byCustomer = new Map();
  rows.flat().forEach((row) => {
    if (!row?._id) return;
    const key = String(row._id);
    const current = byCustomer.get(key) || { count: 0, lastAppliedAt: null };
    const lastAppliedAt =
      current.lastAppliedAt && new Date(current.lastAppliedAt) > new Date(row.lastAppliedAt)
        ? current.lastAppliedAt
        : row.lastAppliedAt;

    byCustomer.set(key, { count: current.count + row.count, lastAppliedAt });
  });

  return customers.map((customer) => ({
    ...customer,
    loans: byCustomer.get(String(customer._id)) || { count: 0, lastAppliedAt: null },
  }));
};

/** Customer ka chhota summary — loans endpoint ke header me jaata hai. */
const customerSummary = (customer) => ({
  _id: customer._id,
  fullName: customer.fullName,
  mobile: customer.mobile,
  panNumber: customer.panNumber,
  email: customer.email || "",
});

/**
 * Us customer ke saare applications, product-wise grouped, aur har ek me wahi
 * status/stage/timeline jo customer apne dashboard par dekhta hai.
 *
 * Scoping do taraf se: loan par `franchiseCustomer` = ye customer, aur
 * `franchise` = calling franchise.
 */
const listCustomerLoans = async (franchise, id) => {
  const customer = await getCustomerDoc(franchise, id);

  const groups = await Promise.all(
    Object.entries(MODELS).map(async ([productKey, Model]) => {
      const applications = await Model.find({ franchiseCustomer: customer._id, franchise: franchise._id }).sort({
        createdAt: -1,
      });
      if (!applications.length) return null;

      return {
        product: productKey,
        count: applications.length,
        applications: applications.map((application) => buildStatusView(productKey, application)),
      };
    })
  );

  const data = groups.filter(Boolean);
  const total = data.reduce((sum, group) => sum + group.count, 0);

  const statusCounts = { Submitted: 0, Pending: 0, Approved: 0, Rejected: 0 };
  data.forEach((group) =>
    group.applications.forEach((application) => {
      const key = application.status || "Submitted";
      if (statusCounts[key] !== undefined) statusCounts[key] += 1;
      else statusCounts.Submitted += 1;
    })
  );

  return { customer: customerSummary(customer), total, byStatus: statusCounts, data };
};

/** Ek application ka status (LOAN000001) — sirf is franchise ke is customer ka. */
const getCustomerLoan = async (franchise, id, applicationNo) => {
  const customer = await getCustomerDoc(franchise, id);

  const code = cleanText(applicationNo).toUpperCase();
  if (!code) throw badRequest("Application number is required");

  for (const [productKey, Model] of Object.entries(MODELS)) {
    const application = await Model.findOne({
      franchiseCustomer: customer._id,
      franchise: franchise._id,
      applicationNo: code,
    });

    if (application) {
      return { customer: customerSummary(customer), application: buildStatusView(productKey, application) };
    }
  }

  throw notFound("Application not found");
};

module.exports = {
  registerCustomer,
  verifyCustomerOtp,
  resendCustomerOtp,
  submitCustomerCreditScore,
  getCustomerLoanDraft,
  cancelCustomerLoanDraft,
  listCustomers,
  getCustomer,
  getCustomerDoc,
  updateCustomer,
  listCustomerLoans,
  getCustomerLoan,
  attachLoanCounts,
  serializeCustomer,
};
