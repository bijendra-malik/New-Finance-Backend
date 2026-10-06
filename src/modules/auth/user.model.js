const mongoose = require("mongoose");
const {
  USER_ROLE,
  USER_ROLE_VALUES,
  FRANCHISE_STATUS,
  FRANCHISE_STATUS_VALUES,
} = require("../../constants/roles");

/*
==========================================
One account collection for BOTH sides of the business:

  role = Customer  -> direct applicant
  role = Franchise -> channel partner (must be approved before it can apply)

The role + this account's _id are baked into the JWT, so no endpoint ever has
to trust a client-sent name/mobile. Franchise-specific fields (state, city,
package, PAN, approval status, FRN code) live on the same document but are only
filled once the franchise submits an application.
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

    /* Location captured at registration (kept on the account so every loan /
       franchise form can pre-fill it). */
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

    /* ---------- Franchise-only fields ---------- */

    // Approval lifecycle. Customers stay at "None".
    franchiseStatus: {
      type: String,
      enum: FRANCHISE_STATUS_VALUES,
      default: FRANCHISE_STATUS.NONE,
    },

    // MINTED BY THE ADMIN on approval (e.g. FRN000125) — this is the franchise's
    // public login id. Sparse so customers don't collide on null.
    franchiseId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      default: undefined,
    },

    // Franchise application details.
    panNumber: { type: String, trim: true, uppercase: true, default: "" },
    state: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },
    package: { type: String, trim: true, default: "" },
    businessDetails: { type: mongoose.Schema.Types.Mixed, default: {} },

    franchiseAppliedAt: { type: Date, default: null },
    franchiseApprovedAt: { type: Date, default: null },
    franchiseRejectedAt: { type: Date, default: null },

    // Franchise password (initially the PAN, always stored as a bcrypt hash).
    // Never selected by default.
    password: { type: String, select: false, default: undefined },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
