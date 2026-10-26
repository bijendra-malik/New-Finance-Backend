/*
==========================================
Final-submit eligibility gate.

Application banne se pehle ke teeno doors yahin se guzarte hain:

  1. POST /api/customer/credit-score                  customer ka draft finalize
  2. POST /api/franchise/customer/.../credit-score    franchise ka draft finalize
  3. POST /api/<product>/apply                        direct product apply

Rules (sab ek hi jagah, taaki koi raasta rule tod na sake):

  1. Company type — employmentType "Salaried" (product ke Salaried default
     samet) hai AUR companyType / companyTypeOther me Partnership ya
     Proprietorship likha hai → us applicant ko loan nahi milta.
  2. Salary mode — Salaried applicant ne "Salary Received As" me Cash ya
     "Electronically deposited-IMPS" chuna → us applicant ko loan nahi milta.
     (Cheque aur Electronically deposited-NFT/RTGS allowed hain.)
  3. Credit score — credit.service.js: score >= 600 + 24-hour window.

Rule fail par 403 throw hota hai — application banti hi nahi, isliye:
  - customer ka draft 24 ghante tak retry ke liye bacha rehta hai, aur
  - admin panel me kabhi aisi application nahi dikhegi jo policy ke against ho.

masters `companyTypes` seed (scripts/seedMasters.js):
  ["Private Limited", "Limited", "Partnership", "Proprietorship", "Government", "Other"]
==========================================
*/

const { assertLoanEligibility, creditStatus, MIN_CREDIT_SCORE } = require("../../customer/credit.service");
const { LOAN_PRODUCTS } = require("./loanProducts");
const { SALARIED } = require("./helpers");

const SALARIED_COMPANY_TYPE_REASON =
  "Salaried applicants from a Partnership or Proprietorship company are not eligible for this loan.";

const SALARY_RECEIVED_AS_REASON =
  "Salary received as Cash or Electronically deposited-IMPS is not eligible for this loan.";

const forbidden = (message) => {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
};

/** Some clients wrap the payload in a `data` object (same rule as loan.service). */
const unwrap = (body) =>
  body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body || {};

/** Dropdown value aur free-text "Other" dono same tarah match hote hain. */
const normalizeText = (value) => String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Blocked company types — case/spacing se farak nahi padta, aur jab
 * companyType = "Other" ho to free-text `companyTypeOther` bhi check hota hai
 * ("Partnership Firm", "Proprietorship" type karne par bhi block).
 */
const isBlockedCompanyType = (value) => {
  const normalized = normalizeText(value);
  return normalized.includes("partnership") || normalized.includes("proprietorship");
};

/**
 * Company-type policy — sirf Salaried applicants par laagu.
 * (Self Employed - Business / Professional par `businessType` alag field hai,
 * wo is rule ka hissa nahi hai.)
 *
 * Returns the rejection reason, or null jab payload pass ho.
 */
/** Payload + resolved employmentType (product ka Salaried default samet). */
const salariedContext = (productKey, body) => {
  const payload = unwrap(body);
  const config = LOAN_PRODUCTS[productKey] || {};
  const employmentType = String(payload.employmentType ?? config.employmentTypeDefault ?? "").trim();
  return { payload, employmentType };
};

const companyTypeRejectionReason = (productKey, body) => {
  const { payload, employmentType } = salariedContext(productKey, body);
  if (employmentType !== SALARIED) return null;

  const blocked = [payload.companyType, payload.companyTypeOther].some(isBlockedCompanyType);
  return blocked ? SALARIED_COMPANY_TYPE_REASON : null;
};

/**
 * masters `salaryReceivedAs`:
 *   ["Cash", "Cheque", "Electronically deposited-IMPS", "Electronically deposited-NFT/RTGS"]
 *
 * Cash aur IMPS wala mode policy ke bahar hai; Cheque / NFT-RTGS allowed.
 * Case/spacing se farak nahi padta, aur "Other" ki free-text
 * (`salaryReceivedAsOther`) bhi isi se check hoti hai.
 */
const isBlockedSalaryReceivedAs = (value) => {
  const normalized = normalizeText(value);
  return normalized.includes("cash") || normalized.includes("imps");
};

const salaryReceivedAsRejectionReason = (productKey, body) => {
  const { payload, employmentType } = salariedContext(productKey, body);
  if (employmentType !== SALARIED) return null;

  const blocked = [payload.salaryReceivedAs, payload.salaryReceivedAsOther].some(
    isBlockedSalaryReceivedAs
  );
  return blocked ? SALARY_RECEIVED_AS_REASON : null;
};

/**
 * Final-submit gate — application create karne se theek pehle call karo.
 *
 * Salaried policy pehle check hoti hai (company type + salary received as) —
 * wo permanent hai: score dobara check karwa kar bhi wo applicant eligible
 * nahi hoga, isliye pehle usi ka clear reason dena sahi hai. Uske baad
 * credit-score rule (600+ + 24-hour window) chalta hai, jiska behavior
 * bilkul waisa hi hai jaisa pehle tha.
 */
const assertLoanApplicationEligibility = (productKey, body, account) => {
  const reason =
    companyTypeRejectionReason(productKey, body) ||
    salaryReceivedAsRejectionReason(productKey, body);
  if (reason) throw forbidden(reason);

  assertLoanEligibility(account);
  return true;
};

/**
 * Credit-score wala hissa — message return karta hai (throw nahi), taaki final
 * submit par wahi reason application ke `adminNote` me save ho sake.
 * Message credit.service.assertLoanEligibility ke bilkul same hain.
 */
const creditRejectionReason = (account) => {
  const status = creditStatus(account);

  if (status.creditScore === null || !account?.creditScoreCheckedAt) {
    return "Please check your credit score before applying for a loan.";
  }

  if (status.creditScore < MIN_CREDIT_SCORE) {
    return `Your credit score is below ${MIN_CREDIT_SCORE}, so you are not eligible to apply for a loan right now.`;
  }

  if (!status.eligible) {
    return "Your 24-hour application window has expired. Please login with your mobile number and check your credit score again.";
  }

  return null;
};

/**
 * Non-throwing version of the final-submit gate.
 *
 * Returns the rejection reason (customer-facing message) ya `null` jab
 * application eligible ho. Final-submit doors ise call karke reason wali
 * application ko `status: "Rejected"` ke saath DB me save karte hain, taaki
 * admin panel (Reject Loans) dekh sake ki form kis condition par reject hua.
 *
 * Order: company type -> salary received as -> credit score.
 */
const loanEligibilityRejectionReason = (productKey, body, account) =>
  companyTypeRejectionReason(productKey, body) ||
  salaryReceivedAsRejectionReason(productKey, body) ||
  creditRejectionReason(account);

module.exports = {
  SALARIED_COMPANY_TYPE_REASON,
  SALARY_RECEIVED_AS_REASON,
  isBlockedCompanyType,
  companyTypeRejectionReason,
  isBlockedSalaryReceivedAs,
  salaryReceivedAsRejectionReason,
  creditRejectionReason,
  loanEligibilityRejectionReason,
  assertLoanApplicationEligibility,
};
