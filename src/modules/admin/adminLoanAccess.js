const PRODUCT_ACCESS_SLUGS = {
  personal: "personal-loan",
  business: "business-loan",
  home: "home-loan",
  lap: "loan-against-property",
  balanceTransfer: "balance-transfer",
  projectLoan: "project-loan",
  vehicleLoan: "car-loan",
  educationLoan: "education-loan",
  creditCard: "credit-card",
  workingCapital: "working-capital",
  commercialPurchase: "commercial-purchase",
  leaseRentalDiscounting: "lease-rental-discounting",
  odCcLimit: "odcc-limit",
  loanAgainstShare: "loan-against-share",
  npaLoan: "npa-loan",
  goldLoan: "gold-loan",
  fdiLoan: "fdi-loan",
  filmFunding: "film-funding",
};

const isSuperAdmin = (admin) => admin?.role === "SuperAdmin";

const hasLoanAccess = (admin, slug) =>
  isSuperAdmin(admin) ||
  admin?.loanAccess === "all" ||
  (Array.isArray(admin?.loanAccess) && admin.loanAccess.includes(slug));

const hasProductAccess = (admin, productKey) => {
  const slug = PRODUCT_ACCESS_SLUGS[productKey];
  return Boolean(slug && hasLoanAccess(admin, slug));
};

/*
A restricted admin ko apne assigned product ka POORA kaam dikhta hai —
Submitted, Pending, Approved aur Rejected sab. Product access pehle hi
`requireLoanAccess` se enforce hota hai, isliye yahan status par koi bandish
nahi lagti.

Pehle yahan `status: { $ne: "Rejected" }` laga hua tha, jiski wajah se:
  - admin ko apne hi product ki rejected applications list me dikhti hi nahi
    thin (na hi detail khul sakti thi),
  - dashboard ka rejected count hamesha 0 aata tha,
  - "Reject Loans" page restricted admin ke liye 403 deta tha.
Ab status sirf data ka hissa hai, chhupane ki wajah nahi.
*/
const visibleLoanFilter = (admin, filter = {}) => {
  void admin;
  return filter;
};

const requireLoanAccess = (productKey) => (req, res, next) => {
  /*
  `productKey` hi pass karna hai — pehle yahan `PRODUCT_ACCESS_SLUGS[productKey]`
  jaata tha, aur `hasProductAccess` us slug ko dobara map karta tha. Natija:
  slug `undefined` ho jata tha aur har restricted admin ko apne assigned product
  par bhi 403 milta tha.
  */
  if (hasProductAccess(req.admin, productKey)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "You do not have permission to access this loan product",
  });
};

module.exports = {
  PRODUCT_ACCESS_SLUGS,
  isSuperAdmin,
  hasLoanAccess,
  hasProductAccess,
  visibleLoanFilter,
  requireLoanAccess,
};
