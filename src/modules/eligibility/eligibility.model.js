const mongoose = require("mongoose");

/*
==========================================
Eligibility checks (website /eligibility-calculator)

Har check — eligible ho ya na ho — yahan save hota hai. Super admin dashboard
isi collection se dekhta hai ki kisne (naam/mobile), kis product ke liye, kab
check kiya aur us waqt kya result aaya.

Numbers snapshot hain, reference nahi: baad me rate card badalne par purana
check apne purane ROI/tenure ke saath hi dikhna chahiye, warna audit galat ho
jaata hai. `inputs` aur `outcome` poora snapshot rakhte hain.
==========================================
*/

const eligibilityCheckSchema = new mongoose.Schema(
  {
    /* Public reference (ELG000001) — support/tracking ke liye. */
    checkNo: { type: String, default: null, trim: true },

    name: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      maxlength: [120, "Full name is too long (max 120 characters)"],
    },
    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      trim: true,
      maxlength: [20, "Mobile number is too long"],
    },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 160 },

    dateOfBirth: { type: Date, required: true },
    age: { type: Number, required: true, min: 0, max: 120 },

    country: { type: String, default: "", trim: true, maxlength: 80 },
    occupation: { type: String, default: "", trim: true, maxlength: 80 },

    /* Admin/list compatibility: legacy code (personal_loan) + UI key (personal). */
    productCode: { type: String, required: true, trim: true },
    productKey: { type: String, default: "", trim: true },
    productLabel: { type: String, required: true, trim: true },
    family: { type: String, default: "", trim: true, maxlength: 20 },

    /* Applicant ka input. */
    monthlyIncome: { type: Number, required: true, min: 0 },
    existingEmi: { type: Number, default: 0, min: 0 },
    creditScore: { type: Number, default: 0, min: 0, max: 900 },

    /* Us waqt ka calculation. */
    netIncome: { type: Number, default: 0, min: 0 },
    foirPercent: { type: Number, default: null },
    maxEmi: { type: Number, default: 0, min: 0 },
    roi: { type: Number, default: null },
    tenureMonths: { type: Number, default: null },
    maxLoanAmount: { type: Number, default: null },
    emi: { type: Number, default: null },
    headline: { type: Number, default: 0, min: 0 },

    eligible: { type: Boolean, default: false },
    /* Not-eligible hone par short reason label; eligible par null. */
    reason: { type: String, default: null, trim: true, maxlength: 300 },
    /* Machine-readable point: CREDIT_SCORE_LOW, NO_EMI_HEADROOM, ... */
    reasonCode: { type: String, default: null, trim: true, maxlength: 60 },
    /* Poora user-facing message (reason se lamba ho sakta hai). */
    message: { type: String, default: "", trim: true, maxlength: 1200 },
    binding: { type: String, default: null, trim: true, maxlength: 160 },
    caps: [
      {
        _id: false,
        key: { type: String, trim: true },
        label: { type: String, trim: true },
        value: { type: Number, default: 0 },
      },
    ],

    /* Audit snapshot: normalized form inputs aur poora engine outcome. */
    inputs: { type: mongoose.Schema.Types.Mixed, default: {} },
    outcome: { type: mongoose.Schema.Types.Mixed, default: {} },

    /* Same submission dobara aaye to naya row na bane. */
    inputHash: { type: String, default: "", trim: true, index: true },

    source: { type: String, default: "website-eligibility-calculator", trim: true, maxlength: 80 },
  },
  { timestamps: true }
);

eligibilityCheckSchema.index({ createdAt: -1 });
eligibilityCheckSchema.index({ eligible: 1, createdAt: -1 });
eligibilityCheckSchema.index({ productCode: 1, createdAt: -1 });
eligibilityCheckSchema.index({ mobile: 1, createdAt: -1 });
eligibilityCheckSchema.index({ mobile: 1, productKey: 1, inputHash: 1, createdAt: -1 });
eligibilityCheckSchema.index({ checkNo: 1 }, { unique: true, sparse: true });

const EligibilityCheck = mongoose.model("EligibilityCheck", eligibilityCheckSchema);

module.exports = { EligibilityCheck };
