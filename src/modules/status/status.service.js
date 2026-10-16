const User = require("../auth/user.model");
const OTP = require("../auth/otp.model");
const sendOTP = require("../../utils/sendOTP");
const { freshOtp, maskMobile } = require("../../utils/otp");
const { MODELS, STATUS_STEP_LABELS } = require("../loans/shared/loanStatus");
const { buildStatusView } = require("../customer/customer.service");

/*
==========================================
Customer ka status door — bina login, bina token.

  POST /api/customer/status/request-otp { customerId, panNumber, mobile } -> OTP
  POST /api/customer/status             { mobile, otp }                   -> process + timeline

OTP request par customer `customerId` + `panNumber` se identify hota hai, aur
diya gaya mobile registered number se match hona chahiye. OTP verify par mobile
aur OTP se customer resolve hota hai.

Response wahi view deta hai jo admin apne dashboard par dekhta hai
(`customer.service.buildStatusView`): status, friendly stage, poora stage list,
timeline ke steps aur admin ka note.
==========================================
*/

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const CUSTOMER_ID_REGEX = /^CUST\d{6}$/;
const STATUS_OTP_PURPOSE = "status";

const cleanText = (value) => String(value ?? "").trim();

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const notFound = (message) => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

const serverError = (message) => {
  const error = new Error(message);
  error.statusCode = 500;
  return error;
};

/*
Customer ID aur PAN dono ka jawab ek hi hai — warna koi sirf ID ya sirf PAN badal
badal kar poochh poochh kar dekh sakta hai ki kaun sa account maujood hai.
*/
const IDENTITY_MISMATCH_MESSAGE =
  "Customer ID and PAN do not match our records. Please check both and try again.";

/** Identity (CUST id + PAN) match karta hua customer — warna 404. */
const findStatusCustomer = async ({ customerId, panNumber }) => {
  const id = cleanText(customerId).toUpperCase();
  const pan = cleanText(panNumber).toUpperCase();

  if (!CUSTOMER_ID_REGEX.test(id)) {
    throw badRequest("Enter a valid customer ID (e.g. CUST000001)");
  }
  if (!PAN_REGEX.test(pan)) {
    throw badRequest("Enter a valid PAN number (e.g. ABCDE1234F)");
  }

  const customer = await User.findOne({ customerId: id });

  if (!customer || cleanText(customer.panNumber).toUpperCase() !== pan) {
    throw notFound(IDENTITY_MISMATCH_MESSAGE);
  }

  return customer;
};

/** Resolve a customer record by its registered mobile before checking the OTP. */
const findStatusCustomerByMobile = async (mobile) => {
  const number = cleanText(mobile);
  if (!/^\d{10}$/.test(number)) {
    throw badRequest("Enter a valid 10-digit mobile number");
  }

  const customer = await User.findOne({ mobile: number });
  if (!customer || !CUSTOMER_ID_REGEX.test(cleanText(customer.customerId))) {
    throw notFound("Customer not found. Please check the mobile number and try again.");
  }

  return customer;
};

/* ------------------------------------------------------- step 1: OTP bhejo -- */

const requestStatusOtp = async ({ customerId, panNumber, mobile }) => {
  const customer = await findStatusCustomer({ customerId, panNumber });

  if (cleanText(mobile) !== cleanText(customer.mobile)) {
    throw notFound(IDENTITY_MISMATCH_MESSAGE);
  }

  const otp = freshOtp();

  // Ek mobile ka ek hi live status OTP (entry ka OTP alag purpose me chalta hai).
  await OTP.deleteMany({ mobile: customer.mobile, purpose: STATUS_OTP_PURPOSE });
  await OTP.create({
    mobile: customer.mobile,
    otp,
    role: customer.role,
    purpose: STATUS_OTP_PURPOSE,
    pendingDetails: null,
    verifiedAt: null,
  });

  const sent = await sendOTP(customer.mobile, otp);
  if (!sent) throw serverError("Unable to send OTP. Please try again later.");

  return {
    message: `OTP sent to ${maskMobile(customer.mobile)}`,
    mobileMasked: maskMobile(customer.mobile),
  };
};

/* -------------------------------------------- step 2: OTP verify + status -- */

const countByStatus = (applications) =>
  applications.reduce(
    (totals, application) => {
      const key = totals[application.status] === undefined ? "Submitted" : application.status;
      totals[key] += 1;
      return totals;
    },
    { Submitted: 0, Pending: 0, Approved: 0, Rejected: 0 }
  );

const getApplicationStatus = async ({ mobile, otp }) => {
  const customer = await findStatusCustomerByMobile(mobile);

  const submittedOtp = cleanText(otp);
  if (!submittedOtp) throw badRequest("OTP is required");

  const otpData = await OTP.findOne({ mobile: customer.mobile, purpose: STATUS_OTP_PURPOSE });
  if (!otpData) throw badRequest("OTP Not Found. Please request a new OTP.");
  if (String(otpData.otp) !== submittedOtp) throw badRequest("Invalid OTP");

  otpData.verifiedAt = new Date();
  await otpData.save();

  const applications = [];
  for (const [productKey, Model] of Object.entries(MODELS)) {
    const rows = await Model.find({ user: customer._id }).sort({ createdAt: -1 });
    rows.forEach((row) => applications.push(buildStatusView(productKey, row)));
  }

  // Naya application pehle — jaisa dashboard/admin me dikhta hai.
  applications.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

  return {
    customer: {
      customerId: customer.customerId,
      name: customer.name,
      mobileMasked: maskMobile(customer.mobile),
      panNumber: customer.panNumber || "",
    },
    total: applications.length,
    byStatus: countByStatus(applications),
    /* Poora process ek nazar me: Submitted -> Under Review -> Approved/Rejected. */
    stages: STATUS_STEP_LABELS,
    applications,
  };
};

module.exports = {
  IDENTITY_MISMATCH_MESSAGE,
  STATUS_OTP_PURPOSE,
  requestStatusOtp,
  getApplicationStatus,
  findStatusCustomer,
  findStatusCustomerByMobile,
};
