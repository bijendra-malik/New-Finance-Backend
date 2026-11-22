const mongoose = require("mongoose");

/*
==========================================
Eligibility checks (website /eligibility-calculator)

Har check — eligible ho ya na ho — yahan save hota hai. Super admin dashboard
isi collection se dekhta hai ki kisne (naam/mobile), kis product ke liye, kab
check kiya aur us waqt kya result aaya.

Numbers snapshot hain, reference nahi: baad me rate card badalne par purana
check apne purane ROI/tenure ke saath hi dikhna chahiye, warna audit galat ho
jaata hai.
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
    /* Website par email optional hai. */
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 160 },

    dateOfBirth: { type: Date, required: true },
    age: { type: Number, required: true, min: 0, max: 120 },

    country: { type: String, default: "", trim: true, maxlength: 80 },
    occupation: { type: String, default: "", trim: true, maxlength: 80 },

    productCode: { type: String, required: true, trim: true },
    productLabel: { type: String, required: true, trim: true },

    /* Applicant ka input. */
    monthlyIncome: { type: Number, required: true, min: 0 },
    existingEmi: { type: Number, default: 0, min: 0 },

    /* Us waqt ka calculation. */
    netIncome: { type: Number, default: 0, min: 0 },
    foirPercent: { type: Number, default: 50 },
    maxEmi: { type: Number, default: 0, min: 0 },
    roi: { type: Number, default: null },
    tenureMonths: { type: Number, default: null },
    maxLoanAmount: { type: Number, default: null },
    emi: { type: Number, default: null },

    eligible: { type: Boolean, default: false },
    /* Not-eligible hone par wajah; eligible par null. */
    reason: { type: String, default: null, trim: true, maxlength: 300 },

    source: { type: String, default: "website-eligibility-calculator", trim: true, maxlength: 80 },
    ip: { type: String, default: "", maxlength: 45 },
  },
  { timestamps: true }
);

eligibilityCheckSchema.index({ createdAt: -1 });
eligibilityCheckSchema.index({ eligible: 1, createdAt: -1 });
eligibilityCheckSchema.index({ productCode: 1, createdAt: -1 });
eligibilityCheckSchema.index({ mobile: 1, createdAt: -1 });
eligibilityCheckSchema.index({ checkNo: 1 }, { unique: true, sparse: true });

const EligibilityCheck = mongoose.model("EligibilityCheck", eligibilityCheckSchema);

module.exports = { EligibilityCheck };
