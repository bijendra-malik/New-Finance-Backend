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

Account sirf mobile OTP verify hone par banta hai (loan entry: `POST /api/auth/:product`,
franchise entry: `POST /api/franchise/entry`). Role decide karta hai ki account
kis collection me jaayega aur kaunsa dashboard / endpoint uske liye khulega.

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
