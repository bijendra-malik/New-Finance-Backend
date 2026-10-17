/*
==========================================
Credit-score eligibility.

New customer flow:

  1. entry + mobile OTP verify
  2. customer submits credit score
       score >= 650 -> eligible, 24-hour window starts
       score <  650 -> not eligible
  3. loan form submit sirf tab tak chalega jab tak window active hai
  4. window beetne ke baad customer phone-OTP login karke score dobara
     check kar sakta hai

Ye rules ek hi jagah hain taaki apply endpoints (per-product + unified) aur
credit-score API kabhi alag-alag decide na karein.
==========================================
*/

const MIN_CREDIT_SCORE = 650;
const CREDIT_SCORE_MIN = 300;
const CREDIT_SCORE_MAX = 900;
const ELIGIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

const forbidden = (message) => {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
};

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const asNumberOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Current eligibility snapshot from the user document.
 *
 * `eligible` is true only when the score qualified AND the 24-hour window is
 * still running. `expired` distinguishes "window over" from "score too low".
 */
const creditStatus = (account) => {
  const score = asNumberOrNull(account?.creditScore);
  const checkedAt = account?.creditScoreCheckedAt || null;
  const expiresAt = account?.creditEligibilityExpiresAt || null;
  const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : 0;
  const withinWindow = Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();

  const qualified = Boolean(account?.creditEligible) && score !== null && score >= MIN_CREDIT_SCORE;
  const eligible = qualified && withinWindow;

  return {
    creditScore: score,
    minCreditScore: MIN_CREDIT_SCORE,
    eligible,
    checkedAt,
    expiresAt: qualified ? expiresAt : null,
    expired: qualified && !withinWindow,
    remainingSeconds: eligible ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)) : 0,
  };
};

/**
 * Stores a freshly submitted credit score on the user document.
 *
 * A qualifying score always starts a NEW 24-hour window (also when the old one
 * had expired), so the customer gets a full day after every re-check.
 */
const applyCreditScore = (account, rawScore) => {
  const score = asNumberOrNull(rawScore);

  if (score === null || !Number.isInteger(score) || score < CREDIT_SCORE_MIN || score > CREDIT_SCORE_MAX) {
    throw badRequest(`Enter a valid credit score between ${CREDIT_SCORE_MIN} and ${CREDIT_SCORE_MAX}`);
  }

  const checkedAt = new Date();
  const eligible = score >= MIN_CREDIT_SCORE;

  account.creditScore = score;
  account.creditScoreCheckedAt = checkedAt;
  account.creditEligible = eligible;
  account.creditEligibilityExpiresAt = eligible
    ? new Date(checkedAt.getTime() + ELIGIBILITY_WINDOW_MS)
    : null;

  return {
    ...creditStatus(account),
    message: eligible
      ? "You are eligible. Please submit your loan application within 24 hours."
      : `Your credit score is below ${MIN_CREDIT_SCORE}, so you are not eligible to apply for a loan right now.`,
  };
};

/**
 * Apply-door guard: score checked, score >= 650, and the 24-hour window active.
 * Throws 403 with a screen-ready message otherwise.
 */
const assertLoanEligibility = (account) => {
  const status = creditStatus(account);

  if (status.creditScore === null || !account?.creditScoreCheckedAt) {
    throw forbidden("Please check your credit score before applying for a loan.");
  }

  if (status.creditScore < MIN_CREDIT_SCORE) {
    throw forbidden(
      `Your credit score is below ${MIN_CREDIT_SCORE}, so you are not eligible to apply for a loan right now.`
    );
  }

  if (!status.eligible) {
    throw forbidden(
      "Your 24-hour application window has expired. Please login with your mobile number and check your credit score again."
    );
  }

  return true;
};

module.exports = {
  MIN_CREDIT_SCORE,
  CREDIT_SCORE_MIN,
  CREDIT_SCORE_MAX,
  ELIGIBILITY_WINDOW_MS,
  creditStatus,
  applyCreditScore,
  assertLoanEligibility,
};
