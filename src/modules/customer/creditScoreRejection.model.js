/*
==========================================
Credit-score rejections (score < 600) — apni chhoti collection.

Kyun alag collection?

  - Loan application tabhi banti hai jab customer loan form submit karta hai.
    Kuch customers loan form bhare bina hi credit score daal dete hain (ya
    unka draft 24 ghante me expire ho jaata hai) — us haal me koi loan document
    banti hi nahi, isliye admin ki Reject Loans list me kuch nahi aata tha.
  - Yahan sirf itna record hota hai: kaun (user + naam + mobile), kitna score,
    aur reject hone ka reason. Product/paisa nahi hota, isliye loan collection
    ko khaali document se ganda nahi karte.

`autoRejectedAt` par wahi TTL index lagta hai jo rule-rejected applications par
lagta hai (loanSchema) — 30 din baad record apne aap delete.
==========================================
*/

const mongoose = require("mongoose");
const { AUTO_REJECTED_TTL_SECONDS } = require("../loans/shared/loanSchema");

const creditScoreRejectionSchema = new mongoose.Schema(
  {
    // Kis customer ka score reject hua.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // List me dikhane ke liye — join ke bina kaam chale.
    fullName: { type: String, default: "" },
    mobile: { type: String, default: "" },

    creditScore: { type: Number, default: null },

    // Customer-facing reason (same message jo customer ko dikhaya jaata hai).
    reason: { type: String, default: "", maxlength: [500, "Note is too long (max 500 characters)"] },

    // TTL marker — isi field par 30-din ka index hai.
    autoRejectedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

creditScoreRejectionSchema.index(
  { autoRejectedAt: 1 },
  { expireAfterSeconds: AUTO_REJECTED_TTL_SECONDS }
);

module.exports = mongoose.models.CreditScoreRejection
  || mongoose.model("CreditScoreRejection", creditScoreRejectionSchema);
