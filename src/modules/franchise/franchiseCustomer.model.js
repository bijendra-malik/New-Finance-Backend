const mongoose = require("mongoose");

/*
==========================================
Franchise ka apna customer — `franchisecustomers` collection.

Franchise apne walk-in customer ko yahan register karta hai, aur usi customer ke
naam par loan apply karta hai:

  POST /api/franchise/customer/register              -> customer save
  POST /api/franchise/customer/:product/applyloan    -> usi customer ke liye loan

Sirf wahi personal details rakhi jaati hain jo loan application ke liye chahiye
(naam, mobile, PAN, DOB + optional email/state/city/pincode). Loan ke waqt
applicant ki details isi document se uthai jaati hain, isliye form inhe dobara
nahi bhejta.

Customer ka login account (`users` collection) alag hota hai: loan banate waqt
mobile se wahi account link ya create kiya jaata hai, taaki customer apna loan
apne dashboard par dekh sake.

`franchise` field hi ownership hai — ek franchise doosri franchise ke customer ko
na dekh sakti hai na use kar sakti hai.
==========================================
*/

const franchiseCustomerSchema = new mongoose.Schema(
  {
    // Owner franchise — yehi field customer ko franchise-scoped banata hai.
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: [true, "Franchise is required"],
      index: true,
    },

    // Franchise ka public FRN code (reports me join ki zaroorat na pade).
    franchiseCode: { type: String, default: null },

    /*
    Sirf normal customer wali details. Is list ke alawa yahan kuch nahi rakhna —
    na occupation, na income, na gender/address/notes. Franchise-specific extra
    cheezein loan application par rehti hain, customer profile me nahi.
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
  },
  { timestamps: true }
);

/*
Ek franchise ek mobile ko do baar register na kare (duplicate customers aur
duplicate loan owners se bachne ke liye). Doosri franchise apna customer alag se
rakh sakti hai — isliye index franchise-scoped hai.
*/
franchiseCustomerSchema.index({ franchise: 1, mobile: 1 }, { unique: true });

module.exports = mongoose.model("FranchiseCustomer", franchiseCustomerSchema);
