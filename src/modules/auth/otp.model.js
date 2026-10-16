const mongoose = require("mongoose");

/*
==========================================
Entry OTP — ek hi document me OTP + jo details user ne step-1 par bhari.

Kyun dono ek saath: entry form kuch save nahi karta, taaki adhoora form chhodhne
par koi half-filled customer record na bane. Details yahan pending rehti hain,
aur OTP verify hone par hi account banta hai + CUST id mint hoti hai
(dekho entry.service.js).

Ek mobile ka ek hi OTP rehta hai — naya entry purane wale ko replace kar deta
hai, isliye ek OTP do jagah (customer entry + franchise entry) use nahi hota.
==========================================
*/

const pendingDetailsSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    mobile: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    dob: { type: Date, default: null },
    panNumber: { type: String, trim: true, uppercase: true, default: "" },
    /* Sirf continent + country — state/city/pincode entry form me nahi hain. */
    continent: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

/*
Franchise entry me jo extra cheezein aati hain — plan aur business ka data. Ye
verify hone par franchise record par utar jaati hain (aur status Pending ho
jaata hai), tab tak yahan pending rehti hain.
*/
const pendingFranchiseSchema = new mongoose.Schema(
  {
    planCode: { type: String, trim: true, uppercase: true, default: "" },
    package: { type: String, trim: true, default: "" },
    businessName: { type: String, trim: true, default: "" },
    businessType: { type: String, trim: true, default: "" },
    gstNumber: { type: String, trim: true, uppercase: true, default: "" },
    address: { type: String, trim: true, default: "" },
    yearsInBusiness: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const otpSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      trim: true,
    },

    otp: {
      type: String,
      required: true,
    },

    /*
    Kis collection me account banana hai — "Customer" (users) ya "Franchise"
    (franchises). Verify isi se sahi model chunta hai.
    */
    role: {
      type: String,
      default: "",
    },

    /*
    Ye OTP kis kaam ka hai:

      "entry"  -> loan entry / franchise entry / franchise ka customer register
                  (account + CUST id banta hai)
      "status" -> customer apna loan status dekhne ke liye OTP maangta hai
                  (`POST /api/status/request-otp`)

    Purpose isliye chahiye: ek mobile ka ek hi OTP doc rehta hai, aur status ka
    OTP entry ka pending OTP uda na de (aur ulta bhi na ho). Purane (is field se
    pehle bane) documents entry ke hi maane jaate hai — entry wale lookups
    `{ purpose: { $ne: "status" } }` se chalte hai.
    */
    purpose: {
      type: String,
      trim: true,
      default: "entry",
    },

    /*
    Customer entry me chuna hua loan product (LOAN_PRODUCTS key, jaise
    "personal"). Franchise entry me khaali — franchise ka koi product nahi hota.
    */
    product: {
      type: String,
      trim: true,
      default: "",
    },

    /* Step-1 par bhari gaya data — verify hone par inse account banta hai. */
    pendingDetails: {
      type: pendingDetailsSchema,
      default: null,
    },

    /* Franchise entry ka plan + business data (sirf franchise entry me). */
    pendingFranchise: {
      type: pendingFranchiseSchema,
      default: null,
    },

    /*
    Franchise ka apna customer ka case: OTP kis franchise ne aur kis customer
    ke liye bheja. Dono sirf tab set hote hain jab franchise apne customer ka OTP
    bhejta hai — direct customer/franchise entry me null. Ye fields
    franchise-scoped check ke liye hain (dusri franchise ka OTP yahan chal na sake).
    */
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      default: null,
    },
    franchiseCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FranchiseCustomer",
      default: null,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OTP", otpSchema);
