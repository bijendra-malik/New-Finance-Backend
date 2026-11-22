const mongoose = require("mongoose");

const franchiseNotificationReadSchema = new mongoose.Schema(
  {
    franchiseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
    /*
    Notification kab read hui — ek row par click ("read") ya poora feed ek saath
    ("read_all"). Super admin ko ye activity dikhti hai, isliye mode save hota hai.
    */
    mode: {
      type: String,
      enum: ["read", "read_all"],
      default: "read",
    },
  },
  { timestamps: true }
);

franchiseNotificationReadSchema.index({ franchiseId: 1, key: 1 }, { unique: true });
franchiseNotificationReadSchema.index({ franchiseId: 1, readAt: -1 });

const FranchiseNotificationRead = mongoose.model(
  "FranchiseNotificationRead",
  franchiseNotificationReadSchema
);

module.exports = { FranchiseNotificationRead };
