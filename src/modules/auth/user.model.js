const mongoose = require("mongoose");
const { USER_ROLE, USER_ROLE_VALUES } = require("../../constants/roles");

/*
==========================================
CUSTOMER accounts live in this collection (`users`).

Account sirf tab banta hai jab loan entry form ka mobile OTP verify hota hai
(entry.service.js) — step-1 par kuch save nahi hota. Usi waqt `customerId`
(CUST000001) mint hoti hai, jo customer ki public identity hai.

Franchise partners ka apna model/collection hai → modules/franchise/franchise.model.js
(`franchises`), kyunki unke fields alag hain (package, PAN, FRN code, approval
trail, login password) aur unhe alag manage karna hai. Ek hi mobile par dono
account ho sakte hain — ID ka prefix (CUST / FRN) alag karta hai.

Is JWT me `{ id, mobile, role }` basta hai, isliye koi endpoint client ke bheje
name/mobile par trust nahi karta.

`USER_ROLE.FRANCHISE` is enum me sirf BACKWARD COMPATIBILITY ke liye rakha gaya
hai: purane franchise documents (migration se pehle) save hone par validate ho
jaayein. Naya franchise account yahan banega hi nahi — wo `franchises` me jaata
hai, aur migration script unhe wahan le jaata hai (scripts/migrateFranchises.js).
==========================================
*/

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      unique: true,
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    role: {
      type: String,
      enum: USER_ROLE_VALUES,
      default: USER_ROLE.CUSTOMER,
    },

    /*
    Public customer id — CUST000001. OTP verify hone par mint hoti hai aur
    status check me yahi identity hoti hai (franchise ka FRN… hota hai).
    Sparse rakhi gayi hai taaki purane (migration se pehle ke) accounts, jinke
    paas ye field nahi hai, save hote waqt collide na karein.
    */
    customerId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      default: undefined,
    },

    /* Loan entry form se aane wale identity fields — mobile OTP inhe verify
       karta hai, isliye loan form inhe dobara nahi maangta. */
    dob: { type: Date, default: null },
    panNumber: { type: String, trim: true, uppercase: true, default: "" },

    /* Location captured at entry (kept on the account so every loan /
       franchise form can pre-fill it). */
    continent: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastLogin: {
      type: Date,
      default: null,
    },

    /*
    Credit-score eligibility (new customer flow):

      creditScore                    -> last score the customer submitted
      creditScoreCheckedAt           -> when it was submitted
      creditEligible                 -> score >= 600
      creditEligibilityExpiresAt     -> checkedAt + 24 hours (null when not eligible)

    Loan apply sirf tab allowed hai jab score qualify kare aur ye window active
    ho (modules/customer/credit.service.js). Window beetne par customer phone
    OTP login karke score dobara check karta hai.
    */
    creditScore: { type: Number, default: null },
    creditScoreCheckedAt: { type: Date, default: null },
    creditEligible: { type: Boolean, default: false },
    creditEligibilityExpiresAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
