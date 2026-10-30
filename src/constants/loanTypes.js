/*
==========================================
Loan product slugs used for admin loan access.

Ye wahi 18 slugs hain jo admin panel ki `constants/loanTypes.ts` bhejta hai.
Backend ke product routes do jagah alag naam use karte hain (`vehicle-loan`,
`od-cc-limit`), lekin `loanAccess` sirf ek permission label hai — isliye panel
ka canonical set yahan rakha gaya hai, taaki dono taraf ek hi list rahe.
==========================================
*/

const LOAN_TYPE_SLUGS = [
  "personal-loan",
  "business-loan",
  "home-loan",
  "loan-against-property",
  "balance-transfer",
  "project-loan",
  "car-loan",
  "education-loan",
  "credit-card",
  "working-capital",
  "commercial-purchase",
  "lease-rental-discounting",
  "odcc-limit",
  "loan-against-share",
  "npa-loan",
  "gold-loan",
  "fdi-loan",
  "film-funding",
];

/** `"all"` means every loan product (super admins always get this). */
const LOAN_ACCESS_ALL = "all";

const isLoanTypeSlug = (value) => LOAN_TYPE_SLUGS.includes(value);

module.exports = {
  LOAN_TYPE_SLUGS,
  LOAN_ACCESS_ALL,
  isLoanTypeSlug,
};
