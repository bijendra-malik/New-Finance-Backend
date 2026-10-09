const mongoose = require("mongoose");

const FranchiseCustomer = require("./franchiseCustomer.model");
const Franchise = require("./franchise.model");
const { MODELS } = require("../loans/shared/loanModels");
const { buildStatusView } = require("../customer/customer.service");

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
  if (!/^\d{10}$/.test(mobile)) throw badRequest("Enter a valid 10-digit mobile number");
  if (!panNumber || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) {
    throw badRequest("Enter a valid PAN number (e.g. ABCDE1234F)");
  }

  const birthDate = new Date(dob);
  if (!dob || Number.isNaN(birthDate.getTime())) {
    throw badRequest("Enter a valid date of birth (YYYY-MM-DD)");
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

  return serializeCustomer(customer);
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
  listCustomers,
  getCustomer,
  getCustomerDoc,
  updateCustomer,
  listCustomerLoans,
  getCustomerLoan,
  attachLoanCounts,
  serializeCustomer,
};
