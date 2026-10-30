const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    /*
    Sign-in handle, e.g. `admin01`. Optional for admins created before the team
    screen existed — those fall back to the email's local part at read time.
    `sparse` keeps the unique index happy for those legacy documents.
    */
    loginId: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      select: false,
    },

    role: {
      type: String,
      enum: ["SuperAdmin", "Admin"],
      default: "Admin",
    },

    /*
    Which loan products this admin may work on: `"all"`, or an array of the
    slugs from `src/constants/loanTypes.js` (e.g. ["personal-loan", "gold-loan"]).
    Admins default to no product access; Super Admins are always forced to
    `"all"` by the service.
    */
    loanAccess: {
      type: mongoose.Schema.Types.Mixed,
      default: [],
    },

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

module.exports = mongoose.model("Admin", adminSchema);
