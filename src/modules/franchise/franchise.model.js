const mongoose = require("mongoose");
const {
  USER_ROLE,
  FRANCHISE_STATUS,
  FRANCHISE_STATUS_VALUES,
} = require("../../constants/roles");

/*
==========================================
Franchise accounts live in their OWN collection (`franchises`).

Yehi pattern project me pehle se hai — `admins` aur har loan product ki apni
collection hai. Franchise ke liye alag collection rakhne ke faayde:

  - ek hi jagah saari franchise: dhoondhna / manage karna / report banana easy
  - franchise kabhi customer list me nahi aa sakti (dono collections hi alag)
  - franchise-only fields (package, FRN code, approval trail, password)
    customer schema me nahi ghusste

Flow (code me exactly yeh hota hai):

  POST /api/auth/register (role "Franchise")  -> franchiseStatus = "None"
  POST /api/auth/verify-otp                   -> JWT, nextStep = franchise-apply
  POST /api/franchise/apply                   -> franchiseStatus = "Pending"
  PATCH /api/admin/franchises/:id/approve     -> FRN000125 + password hash
  POST /api/franchise/login (FRN + password)  -> JWT
  POST /api/franchise/loan-apply              -> loan (Approved hone ke baad hi)

Register karna = approved hona NAHI. Jab tak admin FRN + password nahi deta,
franchise na dashboard khol sakti hai na koi loan apply kar sakti hai
(requireApprovedFranchise guard).
==========================================
*/

const franchiseSchema = new mongoose.Schema(
  {
    /* ---- Registration data (/api/auth/register) ---- */

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

    /*
    Fixed value — poori collection franchise ki hai. Ye field JWT ke `role`
    claim se aata hai, aur yahi `requireFranchise` / `requireCustomer` guards
    ko batata hai ki caller kaun hai. Isliye value constant rakhi gayi hai.
    */
    role: {
      type: String,
      enum: [USER_ROLE.FRANCHISE],
      default: USER_ROLE.FRANCHISE,
    },

    continent: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastLogin: {
      type: Date,
      default: null,
    },

    /* ---- Approval lifecycle — admin isi ko dekhta hai ---- */

    // None -> (applies) -> Pending -> Approved | Rejected
    franchiseStatus: {
      type: String,
      enum: FRANCHISE_STATUS_VALUES,
      default: FRANCHISE_STATUS.NONE,
    },

    // MINTED BY THE ADMIN on approval (e.g. FRN000125) — franchise ka public
    // login id. Sparse so unapproved franchises collide na karein.
    franchiseId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      default: undefined,
    },

    /* ---- Application details (POST /api/franchise/apply) ---- */

    panNumber: { type: String, trim: true, uppercase: true, default: "" },
    state: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },
    package: { type: String, trim: true, default: "" },
    businessDetails: { type: mongoose.Schema.Types.Mixed, default: {} },

    franchiseAppliedAt: { type: Date, default: null },
    franchiseApprovedAt: { type: Date, default: null },
    franchiseRejectedAt: { type: Date, default: null },

    // Initial password = registered mobile number, always stored as a bcrypt
    // hash. Never selected by default.
    password: { type: String, select: false, default: undefined },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Franchise", franchiseSchema);
