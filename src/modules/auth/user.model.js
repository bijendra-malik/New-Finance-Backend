const mongoose = require("mongoose");
const { USER_ROLE, USER_ROLE_VALUES } = require("../../constants/roles");

/*
==========================================
CUSTOMER accounts live in this collection (`users`).

Franchise partners ka apna model/collection hai → modules/franchise/franchise.model.js
(`franchises`), kyunki unke fields alag hain (package, PAN, FRN code, approval
trail, login password) aur unhe alag manage karna hai.

Register me `role` se collection chunti hai (auth.controller.js). Is JWT me
`{ id, mobile, role }` basta hai, isliye koi endpoint client ke bheje name/mobile
par trust nahi karta.

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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
