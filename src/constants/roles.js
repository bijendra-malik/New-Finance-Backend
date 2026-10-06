/*
==========================================
Shared role/token-type constants.
Keeps the "type" claim used to separate admin vs. customer
JWTs (see middleware/adminAuth.js, utils/generateAdminToken.js)
out of hardcoded strings scattered across the codebase.
==========================================
*/

const TOKEN_TYPE = {
  ADMIN: "admin",
  CUSTOMER: "customer",
};

/*
==========================================
Application roles.

One `/auth/register` creates both kinds of account; the role decides which
dashboard and which apply endpoint the account may use.

`LEGACY_CUSTOMER` ("User") is kept in the enum only so accounts created
before this change still validate on save — new registrations always get
CUSTOMER or FRANCHISE.
==========================================
*/
const USER_ROLE = {
  CUSTOMER: "Customer",
  FRANCHISE: "Franchise",
  LEGACY_CUSTOMER: "User",
};

const USER_ROLE_VALUES = Object.values(USER_ROLE);

/*
==========================================
Franchise approval lifecycle.

Registering as a franchise does NOT approve it:
  None -> (applies) -> Pending -> Approved | Rejected
==========================================
*/
const FRANCHISE_STATUS = {
  NONE: "None",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const FRANCHISE_STATUS_VALUES = Object.values(FRANCHISE_STATUS);

module.exports = {
  TOKEN_TYPE,
  USER_ROLE,
  USER_ROLE_VALUES,
  FRANCHISE_STATUS,
  FRANCHISE_STATUS_VALUES,
};
