const mongoose = require("mongoose");

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

    expiresAt: {
      type: Date,
      required: true,
    },

    /*
    Kis collection me account hai — "Customer" (users) ya "Franchise"
    (franchises). Register/login ke waqt role pata hota hai, aur verify par
    yahi field sahi model chunne me madad karti hai (ek hi mobile par dono
    collections me account ho nahi sakta, isliye ye hint authoritative hai).
    Purane OTP documents me ye field nahi hoga — controller us case me dono
    collections me dhoondh leta hai.
    */
    role: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Auto delete after expiry
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("OTP", otpSchema);