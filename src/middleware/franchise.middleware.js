const Franchise = require("../modules/franchise/franchise.model");
const { USER_ROLE, FRANCHISE_STATUS } = require("../constants/roles");

/*
==========================================
Role / franchise-status guards.

`auth.middleware` only proves the token is genuine. These add the second
layer the business rules need:

  requireCustomer          -> only a Customer token may call customer routes
  requireFranchise         -> only a Franchise token may call franchise routes
  loadFranchise            -> loads the account into req.franchise (any status)
  requireApprovedFranchise -> loadFranchise + franchiseStatus must be Approved
                              (registering as a franchise is NOT approval)
==========================================
*/

const forbidden = (res, message) => res.status(403).json({ success: false, message });

const isFranchiseRole = (user) => user && user.role === USER_ROLE.FRANCHISE;

const requireCustomer = (req, res, next) => {
  if (isFranchiseRole(req.user)) {
    return forbidden(res, "This endpoint is for customer accounts. Use the franchise endpoints.");
  }
  next();
};

const requireFranchise = (req, res, next) => {
  if (!isFranchiseRole(req.user)) {
    return forbidden(res, "This endpoint is for franchise accounts only.");
  }
  next();
};

/* Loads the franchise account (whatever its approval status) onto req.franchise. */
const loadFranchise = async (req, res, next) => {
  try {
    // Role is checked BEFORE the status check so a customer token gets a clear
    // "wrong account type" message instead of a misleading "not approved" one.
    if (!isFranchiseRole(req.user)) {
      return forbidden(res, "This endpoint is for franchise accounts only.");
    }

    // Franchise apni collection (`franchises`) me rehti hai — customers ke
    // `users` collection me nahi.
    const franchise = await Franchise.findById(req.user.id);

    if (!franchise) {
      return forbidden(res, "Franchise account not found.");
    }

    req.franchise = franchise;
    next();
  } catch (error) {
    next(error);
  }
};

/* loadFranchise + the application must be Approved before loans can be filed. */
const requireApprovedFranchise = [
  loadFranchise,
  (req, res, next) => {
    if (req.franchise.franchiseStatus !== FRANCHISE_STATUS.APPROVED) {
      return res.status(403).json({
        success: false,
        message:
          req.franchise.franchiseStatus === FRANCHISE_STATUS.REJECTED
            ? "Your franchise application was rejected. Please contact support."
            : "Your franchise is not approved yet. You can apply for loans once the admin approves it.",
        franchiseStatus: req.franchise.franchiseStatus,
      });
    }
    next();
  },
];

module.exports = {
  requireCustomer,
  requireFranchise,
  loadFranchise,
  requireApprovedFranchise,
};
