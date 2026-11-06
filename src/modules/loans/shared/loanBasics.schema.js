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
  // Franchise ke apne customer ka record — body se nahi aata, server set karta hai.
  "franchiseCustomer",
  // Credit score snapshot — account se submit ke waqt copy hota hai, body se nahi.
  "creditScore",
  "creditScoreCheckedAt",
  "creditEligible",
  "creditEligibilityExpiresAt",
];/** Set by the admin panel (PATCH /{resource}/:id/status), never by an applicant. */
const ADMIN_REVIEW_FIELD_NAMES = ["approvedBy", "approvedAt", "rejectedAt", "adminNote", "autoRejectedAt", "adminUpdates", "statusRecommendation"];

/*
==========================================
Pending decision suggestion (sub-schema)

Ye SUB-SCHEMA hai, plain nested object nahi — aur yahi asli bug tha.

Nested object ki har field ka apna default hota hai, isliye Mongoose document
save karte waqt poora block bana deta tha, chahe kisi ne kuch suggest hi na
kiya ho:

  statusRecommendation: { note: "", recommendedByName: "", recommendedByRole: "" }

Natija: jis loan par regular admin sirf ek note likhta tha, wo loan DB me
aisa dikhta tha jaise kisi ne decision SUGGEST kiya ho — bina status, bina
naam, bina note. Aur final decision par `statusRecommendation = null` bhi
tikta nahi tha, kyunki agle save par defaults wapas aa jaate the.

Sub-schema + `default: null` se ab dono cheezein sahi hoti hain: block ya to
poora hota hai ya null — beech ka khaali object kabhi nahi banta.
==========================================
*/
const STATUS_RECOMMENDATION_SCHEMA = new mongoose.Schema(
  {
    status: { type: String, default: null },
    note: { type: String, default: "", maxlength: [500, "Note is too long (max 500 characters)"] },
    recommendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    recommendedByName: { type: String, default: "" },
    recommendedByRole: { type: String, default: "" },
    recommendedAt: { type: Date, default: null },
  },
  { _id: false }
);

/** Mongoose field objects shared by every loan product's schema. */
const ADMIN_REVIEW_FIELDS = {
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  approvedAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
  adminNote: { type: String, default: "", maxlength: [500, "Note is too long (max 500 characters)"] },
  /*
  Rule-based rejection (eligibility gate) ka timestamp — sirf auto-rejected documents par set hota hai. Isi field par TTL index lagta hai (3 din),
  taaki wo record apne aap DB se remove ho jaye. Admin ke manual rejection
  par ye null rehta hai — uska record kabhi delete nahi hota.
  */
  autoRejectedAt: { type: Date, default: null },
  /*
  Latest status suggested by a regular admin. Only a super admin can apply a
  final decision; this is what the super admin sees on the dashboard and the
  application detail page so a review never gets lost in a comment thread.
  */
  statusRecommendation: { type: STATUS_RECOMMENDATION_SCHEMA, default: null },
  /*
  Admin updates/remarks added by any admin with access (regular admins can add updates,
  super admins can see all). Each entry tracks who added it and when.
  */
  adminUpdates: [
    {
      text: { type: String, required: true, maxlength: [500, "Update is too long (max 500 characters)"] },
      addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
      addedByName: { type: String, default: "" },
      addedByRole: { type: String, default: "" },
      addedAt: { type: Date, default: Date.now },
      // note = plain remark, recommendation = suggested decision, status = final decision log
      kind: { type: String, default: "note" },
      suggestedStatus: { type: String, default: null },
    },
  ],
};

/*
==========================================
Credit score snapshot (same for every product)

Customer account par sirf LATEST score rehta hai (har re-check par overwrite).
Har application apna snapshot rakhti hai — jo score us application ke submit ke
waqt valid tha — taaki agle loan ke liye naya score bharne par purani
application ka score na badle.
==========================================
*/
const CREDIT_SNAPSHOT_FIELDS = {
  creditScore: { type: Number, default: null, min: 300, max: 900 },
  creditScoreCheckedAt: { type: Date, default: null },
  creditEligible: { type: Boolean, default: null },
  creditEligibilityExpiresAt: { type: Date, default: null },
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
  // Franchise apni alag collection me hai, isliye ref "Franchise" hai.
  franchise: { type: mongoose.Schema.Types.ObjectId, ref: "Franchise", default: null },
  franchiseCode: { type: String, default: null },
  applicationNo: { type: String, default: null },
  /*
  Franchise ka apna customer (franchisecustomers collection) — uske naam par loan
  file hua tha. Direct customer application me null.
  */
  franchiseCustomer: { type: mongoose.Schema.Types.ObjectId, ref: "FranchiseCustomer", default: null },
};

module.exports = {
  LOAN_FIELD_NAMES,
  SERVER_MANAGED_FIELD_NAMES,
  ADMIN_REVIEW_FIELD_NAMES,
  ADMIN_REVIEW_FIELDS,
  CREDIT_SNAPSHOT_FIELDS,
  FRANCHISE_FIELDS,
};
