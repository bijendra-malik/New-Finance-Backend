const mongoose = require("mongoose");
const { CIBIL_STATUS, CIBIL_STATUS_VALUES } = require("../../constants/cibil");

/*
==========================================
Franchise ka apna customer — `franchisecustomers` collection.

Franchise apne walk-in customer ko yahan register karta hai (basic details), aur
usi document par uska CIBIL result store hota hai. Loan form TABHI khulta hai
jab CIBIL check pass ho jaaye:

  POST /api/franchise/customer                    -> basic details save, LOCKED
  POST /api/franchise/customer/:id/cibil-check     -> score aata hai
  GET  /api/franchise/customer/:id/eligibility     -> canApplyLoan true/false
  POST /api/franchise/loan-apply                   -> sirf eligible customer par

Customer account (`users` collection) alag hi rehta hai: loan banate waqt mobile
se wahi account link/create hota hai, taaki customer apna loan dekh sake.

`franchise` field hi ownership hai — ek franchise dusre franchise ke customer ko
na dekhe na use kare.
==========================================
*/

const cibilSchema = new mongoose.Schema(
  {
    // "NotChecked" -> abhi tak check nahi (form LOCKED)
    // "Checked"    -> score mila (threshold se compare hota hai)
    // "Failed"     -> provider ne jawab nahi diya (dobara try karein)
    status: {
      type: String,
      enum: CIBIL_STATUS_VALUES,
      default: CIBIL_STATUS.NOT_CHECKED,
    },
    score: { type: Number, default: null },
    band: { type: String, default: null },
    bureau: { type: String, default: null },
    provider: { type: String, default: null },
    referenceId: { type: String, default: null },
    checkedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
  },
  { _id: false }
);

const franchiseCustomerSchema = new mongoose.Schema(
  {
    // Owner franchise — yehi cheez customer ko franchise-scoped banati hai.
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: [true, "Franchise is required"],
      index: true,
    },

    // Franchise ka public FRN code (reports me join ki zaroorat na pade).
    franchiseCode: { type: String, default: null },

    /* ---- Step 1: basic details (CIBIL check ke liye bhi yahi chahiye) ---- */

    /*
    Sirf wahi details jo normal customer ki hoti hain — is list ke alawa yahan
    kuch nahi rakhna (nahi occupation, nahi income, nahi gender/address/notes).
    Franchise ke liye extra cheezen `notes` ki jagah loan application par hain.
    */

    fullName: { type: String, required: [true, "Customer name is required"], trim: true },
    mobile: { type: String, required: [true, "Mobile number is required"], trim: true },
    panNumber: {
      type: String,
      required: [true, "PAN number is required"],
      trim: true,
      uppercase: true,
    },
    dob: { type: Date, required: [true, "Date of birth is required"] },
    email: { type: String, lowercase: true, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },

    // Customer ne bureau check ki likhit sehmati di (bureau ki requirement).
    cibilConsentAt: { type: Date, default: null },

    /* ---- Step 2: credit check result ---- */
    cibil: { type: cibilSchema, default: () => ({}) },
  },
  { timestamps: true }
);

/*
Ek franchise ek mobile ko do baar register na kare (duplicate CIBIL checks aur
duplicate loan owners se bachne ke liye). Dusri franchise apna customer alag se
rakh sakti hai — isliye index franchise-scoped hai.
*/
franchiseCustomerSchema.index({ franchise: 1, mobile: 1 }, { unique: true });

module.exports = mongoose.model("FranchiseCustomer", franchiseCustomerSchema);
