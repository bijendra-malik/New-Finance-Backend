const mongoose = require("mongoose");

const franchiseCustomerLoanDraftSchema = new mongoose.Schema(
  {
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: true,
    },
    franchiseCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FranchiseCustomer",
      required: true,
      unique: true,
    },
    draftId: { type: String, required: true },
    product: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

franchiseCustomerLoanDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("FranchiseCustomerLoanDraft", franchiseCustomerLoanDraftSchema);
