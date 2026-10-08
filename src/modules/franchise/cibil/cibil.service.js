const {
  CIBIL_STATUS,
  CIBIL_LOCK_REASONS,
  bandForScore,
  cibilProviderName,
  cibilScoreThreshold,
  cibilValidityDays,
} = require("../../../constants/cibil");
const { resolveProvider } = require("./providers");

/*
==========================================
CIBIL service — franchise ke loan form ka LOCK/UNLOCK yahin decide hota hai.

Rule (franchise flow):
    customer basic details save  -> status "NotChecked" -> LOAN FORM LOCKED
    CIBIL check success + score >= threshold + report valid -> UNLOCKED
    check fail / low score / report expired -> LOCKED

Ye service sirf result compute + persist karti hai; "kaunsa provider" ka faisla
providers/index.js karta hai, isliye real bureau sirf ek file add karne se
plug ho jaayega.
==========================================
*/

const notConfiguredMessage = (customer) =>
  `CIBIL details are incomplete for this customer (name, PAN, DOB, mobile are required).`;

/** Basic details jo bureau ko chahiye — inke bina check shuru hi nahi hota. */
const missingCibilInputs = (customer) => {
  const missing = [];
  if (!customer?.fullName) missing.push("fullName");
  if (!customer?.panNumber) missing.push("panNumber");
  if (!customer?.dob) missing.push("dob");
  if (!customer?.mobile) missing.push("mobile");
  return missing;
};

const isExpired = (cibil) => Boolean(cibil?.expiresAt && new Date(cibil.expiresAt).getTime() < Date.now());

/**
 * Customer ke CIBIL state ka single source of truth — har response (customer
 * detail, cibil-check, loan-apply) yahi object use karta hai.
 */
const buildEligibility = (customer) => {
  const cibil = customer?.cibil || {};
  const threshold = cibilScoreThreshold();
  const status = cibil.status || CIBIL_STATUS.NOT_CHECKED;
  const score = Number.isFinite(Number(cibil.score)) && cibil.score !== null ? Number(cibil.score) : null;

  const base = {
    status,
    score,
    band: bandForScore(score),
    provider: cibil.provider || null,
    referenceId: cibil.referenceId || null,
    checkedAt: cibil.checkedAt || null,
    expiresAt: cibil.expiresAt || null,
    failureReason: cibil.failureReason || null,
    threshold,
  };

  const lock = (reason) => ({ ...base, canApplyLoan: false, locked: true, reason });

  if (status === CIBIL_STATUS.NOT_CHECKED) return lock(CIBIL_LOCK_REASONS.NOT_CHECKED);
  if (status === CIBIL_STATUS.FAILED) return lock(CIBIL_LOCK_REASONS.FAILED);
  if (isExpired(cibil)) return lock(CIBIL_LOCK_REASONS.EXPIRED);
  if (score === null || score < threshold) return lock(CIBIL_LOCK_REASONS.LOW_SCORE);

  return { ...base, canApplyLoan: true, locked: false, reason: null };
};

/** 403-style error jab locked state me loan apply kiya jaaye. */
const lockedError = (eligibility) => {
  const error = new Error(eligibility.reason);
  error.statusCode = 403;
  error.lockReason = eligibility.reason;
  error.cibil = eligibility;
  return error;
};

/**
 * Provider se score lekar customer par save karta hai.
 * `customer.save()` caller ke paas hai, isliye ye sirf updated doc return karta hai.
 */
const runCibilCheck = async (customer) => {
  const missing = missingCibilInputs(customer);
  if (missing.length) {
    const error = new Error(`${notConfiguredMessage(customer)} Missing: ${missing.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const provider = resolveProvider();
  const validityDays = cibilValidityDays();

  let result;
  try {
    result = await provider.fetchScore({
      panNumber: customer.panNumber,
      fullName: customer.fullName,
      mobile: customer.mobile,
      dob: customer.dob,
    });
  } catch (error) {
    result = { success: false, failureReason: error?.message || "CIBIL provider request failed" };
  }

  if (!result || result.success !== true || !Number.isFinite(Number(result.score))) {
    customer.cibil = {
      status: CIBIL_STATUS.FAILED,
      score: null,
      provider: provider.name,
      referenceId: result?.referenceId || null,
      checkedAt: new Date(),
      expiresAt: null,
      failureReason: result?.failureReason || "CIBIL provider did not return a score",
    };

    return customer;
  }

  const checkedAt = new Date();
  const expiresAt = new Date(checkedAt.getTime() + validityDays * 24 * 60 * 60 * 1000);

  customer.cibil = {
    status: CIBIL_STATUS.CHECKED,
    score: Number(result.score),
    band: bandForScore(result.score)?.key || null,
    bureau: result.bureau || provider.name,
    provider: provider.name,
    referenceId: result.referenceId || null,
    checkedAt,
    expiresAt,
    failureReason: null,
  };

  return customer;
};

module.exports = {
  buildEligibility,
  runCibilCheck,
  lockedError,
  missingCibilInputs,
  isExpired,
  providerName: cibilProviderName,
};
