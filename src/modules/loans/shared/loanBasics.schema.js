/* =========================================================================
 * STEP 1 — Loan Basics (same for every product)
 * =========================================================================
 * The two fields every loan application has, plus the fields the server owns
 * (the applicant must never send those).
 * ========================================================================= */

const mongoose = require("mongoose");

/** Fields the applicant always fills (loanTenure is stored in YEARS). */
const LOAN_FIELD_NAMES = ["loanAmount", "loanTenure"];

/** Set by the server / route, never by the applicant. */
const SERVER_MANAGED_FIELD_NAMES = [
  "user",
  "loanType",
  "status",
  "createdAt",
  "updatedAt",
  "__v",
  "_id",
  // Which channel submitted the application (null = direct customer).
  "franchise",
  "franchiseCode",
  // Human-readable per-application id (LOAN000001).
  "applicationNo",
];

/** Set by the admin panel (PATCH /{resource}/:id/status), never by an applicant. */
const ADMIN_REVIEW_FIELD_NAMES = ["approvedBy", "approvedAt", "rejectedAt", "adminNote"];

/** Mongoose field objects shared by every loan product's schema. */
const ADMIN_REVIEW_FIELDS = {
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  approvedAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
  adminNote: { type: String, default: "", maxlength: [500, "Note is too long (max 500 characters)"] },
};

/*
==========================================
Franchise linkage (same for every product)

  franchise     null  -> the customer applied directly
  franchise  <id>     -> an approved franchise submitted it on the customer's
                         behalf; `franchiseCode` (FRN000125) is denormalised so
                         admin lists/reports never need a join.
==========================================
*/
const FRANCHISE_FIELDS = {
  franchise: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  franchiseCode: { type: String, default: null },
  applicationNo: { type: String, default: null },
};

module.exports = {
  LOAN_FIELD_NAMES,
  SERVER_MANAGED_FIELD_NAMES,
  ADMIN_REVIEW_FIELD_NAMES,
  ADMIN_REVIEW_FIELDS,
  FRANCHISE_FIELDS,
};
