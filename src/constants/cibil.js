/*
==========================================
CIBIL (credit bureau) constants.

Franchise flow: pehle customer ki basic details save hoti hain, phir CIBIL check
hoti hai, tabhi loan form UNLOCK hota hai. Ye file un saari values ko ek jagah
rakhti hai jo lock/unlock decide karti hain.

Env se override (optional):
  CIBIL_PROVIDER         -> "mock" (default) ya aapke real provider ka naam
  CIBIL_SCORE_THRESHOLD  -> loan form unlock karne ke liye minimum score (650)
  CIBIL_VALIDITY_DAYS    -> report kitne din valid hai (90)
==========================================
*/

/** Ek customer ka CIBIL check ka state. */
const CIBIL_STATUS = {
  // Basic details save ho gayi hain, check hua hi nahi -> form LOCKED.
  NOT_CHECKED: "NotChecked",
  // Bureau ne score diya -> score threshold se compare hota hai.
  CHECKED: "Checked",
  // Bureau/network ne jawab nahi diya -> dobara try karna hai, form LOCKED.
  FAILED: "Failed",
};

const CIBIL_STATUS_VALUES = Object.values(CIBIL_STATUS);

/** Score bands — sirf display/label ke liye. */
const CIBIL_BANDS = [
  { key: "excellent", label: "Excellent", min: 750 },
  { key: "good", label: "Good", min: 700 },
  { key: "fair", label: "Fair", min: 650 },
  { key: "poor", label: "Poor", min: 0 },
];

const bandForScore = (score) => {
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  return CIBIL_BANDS.find((band) => value >= band.min) || null;
};

/** Provider + policy defaults (env se override ho sakte hain). */
const CIBIL_DEFAULTS = {
  PROVIDER: "mock",
  SCORE_THRESHOLD: 650,
  VALIDITY_DAYS: 90,
};

const cibilProviderName = () => String(process.env.CIBIL_PROVIDER || CIBIL_DEFAULTS.PROVIDER).trim() || "mock";

const cibilScoreThreshold = () => {
  const value = Number(process.env.CIBIL_SCORE_THRESHOLD);
  return Number.isFinite(value) && value > 0 ? value : CIBIL_DEFAULTS.SCORE_THRESHOLD;
};

const cibilValidityDays = () => {
  const value = Number(process.env.CIBIL_VALIDITY_DAYS);
  return Number.isFinite(value) && value > 0 ? value : CIBIL_DEFAULTS.VALIDITY_DAYS;
};

/** Form lock hone ka reason (frontend isi text ko dikhata hai). */
const CIBIL_LOCK_REASONS = {
  NOT_CHECKED: "CIBIL check is pending for this customer. Run the CIBIL check to unlock the loan form.",
  FAILED: "The CIBIL check could not be completed. Please try again to unlock the loan form.",
  LOW_SCORE: "CIBIL score is below the required threshold. Loan form stays locked.",
  EXPIRED: "The CIBIL report has expired. Run a fresh check to unlock the loan form.",
};

module.exports = {
  CIBIL_STATUS,
  CIBIL_STATUS_VALUES,
  CIBIL_BANDS,
  CIBIL_DEFAULTS,
  CIBIL_LOCK_REASONS,
  bandForScore,
  cibilProviderName,
  cibilScoreThreshold,
  cibilValidityDays,
};
