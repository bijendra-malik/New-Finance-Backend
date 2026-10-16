const Franchise = require("./franchise.model");
const OTP = require("../auth/otp.model");
const sendOTP = require("../../utils/sendOTP");
const { freshOtp, maskMobile } = require("../../utils/otp");

const STATUS_OTP_PURPOSE = "franchise-status";
const IDENTITY_MISMATCH_MESSAGE =
  "Mobile number and PAN do not match our franchise records. Please check both and try again.";

const cleanText = (value) => String(value ?? "").trim();

const notFound = (message) => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const serverError = (message) => {
  const error = new Error(message);
  error.statusCode = 500;
  return error;
};

const findFranchiseByIdentity = async ({ mobile, panNumber }) => {
  const number = cleanText(mobile);
  const pan = cleanText(panNumber).toUpperCase();
  const franchise = await Franchise.findOne({ mobile: number });

  if (!franchise || cleanText(franchise.panNumber).toUpperCase() !== pan) {
    throw notFound(IDENTITY_MISMATCH_MESSAGE);
  }

  return franchise;
};

const requestStatusOtp = async ({ mobile, panNumber }) => {
  const franchise = await findFranchiseByIdentity({ mobile, panNumber });
  const otp = freshOtp();

  await OTP.deleteMany({ mobile: franchise.mobile, purpose: STATUS_OTP_PURPOSE });
  await OTP.create({
    mobile: franchise.mobile,
    otp,
    role: franchise.role,
    purpose: STATUS_OTP_PURPOSE,
    pendingDetails: null,
    verifiedAt: null,
  });

  const sent = await sendOTP(franchise.mobile, otp);
  if (!sent) throw serverError("Unable to send OTP. Please try again later.");

  return {
    message: `OTP sent to ${maskMobile(franchise.mobile)}`,
    mobileMasked: maskMobile(franchise.mobile),
  };
};

const buildStatus = (franchise) => {
  const franchiseStatus = franchise.franchiseStatus || "None";
  const adminNote = cleanText(franchise.businessDetails?.adminNote);
  const payload = {
    franchise: {
      name: franchise.name || "",
      mobileMasked: maskMobile(franchise.mobile),
    },
    franchiseStatus,
    canLogin: franchiseStatus === "Approved",
    updatedAt: franchise.updatedAt || null,
  };

  if (franchiseStatus === "Approved") {
    payload.message =
      "Your franchise is approved. Please login with the franchise ID and password shared by the admin.";
    payload.approvedAt = franchise.franchiseApprovedAt || null;
  } else if (franchiseStatus === "Pending") {
    payload.message = "Your franchise application is pending admin approval.";
    payload.appliedAt = franchise.franchiseAppliedAt || null;
  } else if (franchiseStatus === "Rejected") {
    payload.rejectionReason = adminNote;
    payload.rejectedAt = franchise.franchiseRejectedAt || null;
    payload.message = adminNote
      ? `Your franchise application was rejected. Reason: ${adminNote}`
      : "Your franchise application was rejected. Please contact support for the reason.";
  } else {
    payload.message = "Franchise application abhi submit nahi hui hai. Please fill the franchise form.";
  }

  return payload;
};

const getStatus = async ({ mobile, otp }) => {
  const number = cleanText(mobile);
  const submittedOtp = cleanText(otp);
  const franchise = await Franchise.findOne({ mobile: number });

  if (!franchise) throw notFound("Franchise not found. Please check the mobile number and try again.");
  if (!submittedOtp) throw badRequest("OTP is required");

  const otpData = await OTP.findOne({ mobile: number, purpose: STATUS_OTP_PURPOSE });
  if (!otpData) throw badRequest("OTP Not Found. Please request a new OTP.");
  if (String(otpData.otp) !== submittedOtp) throw badRequest("Invalid OTP");

  otpData.verifiedAt = new Date();
  await otpData.save();

  return buildStatus(franchise);
};

module.exports = { requestStatusOtp, getStatus };
