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

const MODULE_ACCESS_KEYS = ["customers", "franchises"];
const MODULE_ACCESS_ALL = "all";

const isSuperAdmin = (admin) => admin?.role === "SuperAdmin";

const hasLoanAccess = (admin, slug) =>
  isSuperAdmin(admin) ||
  admin?.loanAccess === "all" ||
  (Array.isArray(admin?.loanAccess) && admin.loanAccess.includes(slug));

const hasModuleAccess = (admin, moduleKey) => {
  if (isSuperAdmin(admin)) return true;
  if (!moduleKey) return false;
  if (admin?.moduleAccess === MODULE_ACCESS_ALL) return true;
  if (Array.isArray(admin?.moduleAccess)) {
    return admin.moduleAccess.includes(moduleKey);
  }
  return false;
};

const hasProductAccess = (admin, productKey) => {
  const slug = PRODUCT_ACCESS_SLUGS[productKey];
  return Boolean(slug && hasLoanAccess(admin, slug));
};

/*
Product workspaces me restricted admin ko apne assigned product ke direct
customer applications dikhte hain — Submitted, Pending, Approved aur Rejected
sab. Customer module access sirf customer listing/profile ke liye hai; woh loan
product workspaces ya applications ka access nahi deta. Franchise-origin
applications franchise ke separate workflow me rehte hain, so only SuperAdmin
can see them through product endpoints.

Pehle yahan `status: { $ne: "Rejected" }` laga hua tha, jiski wajah se:
  - admin ko apne hi product ki rejected applications list me dikhti hi nahi
    thin (na hi detail khul sakti thi),
  - dashboard ka rejected count hamesha 0 aata tha,
  - "Reject Loans" page restricted admin ke liye 403 deta tha.
Ab status sirf data ka hissa hai, chhupane ki wajah nahi.
*/
const visibleLoanFilter = (admin, filter = {}) => {
  return isSuperAdmin(admin) ? filter : { ...filter, franchise: null };
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

const requireModuleAccess = (moduleKey) => (req, res, next) => {
  if (hasModuleAccess(req.admin, moduleKey)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: `You do not have permission to access this module`,
  });
};

module.exports = {
  PRODUCT_ACCESS_SLUGS,
  MODULE_ACCESS_KEYS,
  MODULE_ACCESS_ALL,
  isSuperAdmin,
  hasLoanAccess,
  hasProductAccess,
  hasModuleAccess,
  visibleLoanFilter,
  requireLoanAccess,
  requireModuleAccess,
};
