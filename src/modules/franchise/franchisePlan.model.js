const mongoose = require("mongoose");

/*
==========================================
Franchise Investment plans — apni collection (`franchiseplans`).

Frontend ke /franchise page ka "Plans & fees" section pehle hardcoded tha.
Ab har plan ek document hai jo admin manage karta hai, aur franchise UI
GET /api/franchise/plans se padhta hai.

Design me do cheezein jaan-boojh kar aise hain:

1) `fee` BASE fee hai (GST ke bina). GST `gstPercent` se compute hoti hai.
   UI par "₹2.49 Lakh + GST" likha hai — isliye base store karna hi sahi hai,
   warna GST badalne par poori price row dobara likhni padegi aur GST report
   me total ke andar GST dhoondhna mushkil ho jaayega.

2) `durationMonths` asli source of truth hai — `name` sirf display ke liye hai.
   "3 Years" label isi se derive hota hai (franchisePlan.service.js), taaki
   naam aur validity kabhi aapas me mismatch na ho jaayein.

Effective monthly cost aur GST amount kabhi store NAHI hote — wo hamesha
service me compute hote hain. Isse ek hi jagah sach hota hai.
==========================================
*/

const franchisePlanSchema = new mongoose.Schema(
  {
    /*
    Stable public identifier (e.g. "3Y"). Ye kabhi change nahi hota — frontend
    aur purane franchise records isi code se plan pehchaante hain, isliye plan
    ka naam/duration badalne par bhi code same rehta hai.
    */
    code: {
      type: String,
      required: [true, "Plan code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },

    // Display name — "3-Year Plan"
    name: {
      type: String,
      required: [true, "Plan name is required"],
      trim: true,
    },

    // Validity — plan ki asli umar. Isi se validityLabel aur effective monthly banta hai.
    durationMonths: {
      type: Number,
      required: [true, "Duration (in months) is required"],
      min: [1, "Duration must be at least 1 month"],
    },

    // GST-exclusive base fee, rupees me (249000).
    fee: {
      type: Number,
      required: [true, "Fee is required"],
      min: [0, "Fee cannot be negative"],
    },

    currency: {
      type: String,
      trim: true,
      default: "INR",
    },

    // Fees exclusive of GST hain — total = fee + (fee * gstPercent / 100).
    gstPercent: {
      type: Number,
      min: [0, "GST percent cannot be negative"],
      max: [100, "GST percent cannot exceed 100"],
      default: 18,
    },

    /*
    Renewal do tarah ka hota hai, isliye dono fields hain:
      - renewalFee  : fixed amount (3-year plan ka ₹3,900)
      - renewalNote : agar amount fix nahi hai to text ("As applicable")
    Service `renewalText` deta hai jo UI seedha dikha sakta hai.
    */
    renewalFee: {
      type: Number,
      min: [0, "Renewal fee cannot be negative"],
      default: null,
    },

    renewalNote: {
      type: String,
      trim: true,
      default: "As applicable",
    },

    // UI ke bullets — "Franchise access for 3 years"
    features: {
      type: [String],
      default: [],
    },

    /*
    "Best Value" badge. Ek waqt par sirf EK plan par true hota hai — service
    (franchisePlan.service.js -> pinBestValue) baaki sab par false kar deti hai.
    */
    isBestValue: {
      type: Boolean,
      default: false,
    },

    /*
    Soft delete. Plan ko hard delete nahi karte kyunki purane franchise records
    us plan code ka snapshot rakhte hain; inactive plan sirf public list se
    hat jaata hai.
    */
    isActive: {
      type: Boolean,
      default: true,
    },

    // Display order — admin ke hisaab se (3Y pehle, phir 1Y, 6M, 3M, 1M).
    sortOrder: {
      type: Number,
      default: 0,
    },

    // Audit — kaun admin ne banaya/update kiya.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  {
    timestamps: true,
  }
);

// Public list ka exact query: active plans, sorted.
franchisePlanSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model("FranchisePlan", franchisePlanSchema);
