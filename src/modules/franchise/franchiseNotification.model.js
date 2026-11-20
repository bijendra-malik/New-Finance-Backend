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
