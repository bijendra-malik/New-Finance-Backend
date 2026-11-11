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

    /*
    SuperAdmin  -> poora panel
    SubAdmin    -> sirf super admin ke diye permissions ke andar review kaam
    Admin       -> regular operations admin
    */
    role: {
      type: String,
      enum: ["SuperAdmin", "SubAdmin", "Admin"],
      default: "Admin",
    },

    /*
    Sub admin capabilities (`updates.view`, `updates.review`, `loans.decide`, …).
    Regular admins ke liye khaali rehti hai; SuperAdmin ke paas hamesha sab kuch
    hota hai (service compute karti hai, field par bharosa nahi).
    */
    permissions: {
      type: [String],
      default: [],
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

    /*
    Module-level access: `"all"` or keys like `["customers", "franchises"]`.
    Customer access grants customer list/profile visibility; loanAccess
    separately controls loan product workspaces. Super Admins always have
    access to all modules. Regular admins get only modules explicitly assigned.
    */
    moduleAccess: {
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

/*
==========================================
Database Indexes for Performance
==========================================
*/

// Admin login and status checks
adminSchema.index({ isActive: 1, role: 1 });

// Sub admins are listed/looked up by role in the team screen
adminSchema.index({ role: 1, createdAt: 1 });

// Recent login tracking
adminSchema.index({ lastLogin: -1 });

module.exports = mongoose.model("Admin", adminSchema);
