const mongoose = require("mongoose");

/*
==========================================
Sub-admin review of an admin update

Ek update ka review record. `key` exactly wahi identity hai jo frontend
banata hai:

  entity (loan|customer|franchise) : applicationId : updateId

Isliye reload / dusre browser par bhi wahi row wahi state dikhati hai — pehle
ye state browser ke localStorage me thi, jiski wajah se supervisor ka kaam
device badalne par gum ho jaata tha.

States:
  pending   -> abhi review nahi hua (record hi nahi hota)
  verified  -> kaam sahi mila
  returned  -> admin ko correction ke liye wapas
  escalated -> super admin ke decision ke liye bheja
  decided   -> final decision record hua
==========================================
*/

const REVIEW_STATES = ["pending", "verified", "returned", "escalated", "decided"];

const REVIEW_ENTITIES = ["loan", "customer", "franchise"];

const MAX_REVIEW_NOTE = 500;

const adminReviewSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },

    entity: { type: String, enum: REVIEW_ENTITIES, default: "loan" },
    applicationId: { type: String, default: "" },
    updateId: { type: String, default: "" },

    /*
    Scope snapshot: review us waqt ke scope ka hissa tha. Isse supervisor
    dashboard scope ke hisaab se counts nikal sakta hai, chahe admin ka
    loanAccess baad me badal jaaye.
    */
    scopeKey: {
      type: String,
      enum: ["loans", "modules"],
      default: "loans",
    },
    slug: { type: String, default: "" },

    state: { type: String, enum: REVIEW_STATES, default: "verified" },

    note: {
      type: String,
      default: "",
      maxlength: [
        MAX_REVIEW_NOTE,
        `Review note is too long (max ${MAX_REVIEW_NOTE} characters)`,
      ],
    },

    /* Update kis admin ka tha — self-review block aur "kis admin par load" ke liye. */
    updateAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    updateAdminName: { type: String, default: "" },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    reviewedByName: { type: String, default: "" },
    reviewedByRole: { type: String, default: "" },
    reviewedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

adminReviewSchema.index({ state: 1, reviewedAt: -1 });
adminReviewSchema.index({ scopeKey: 1, state: 1 });
adminReviewSchema.index({ slug: 1, state: 1 });
adminReviewSchema.index({ updateAdminId: 1, reviewedAt: -1 });

const AdminReview = mongoose.model("AdminReview", adminReviewSchema);

module.exports = {
  AdminReview,
  REVIEW_STATES,
  REVIEW_ENTITIES,
  MAX_REVIEW_NOTE,
};
