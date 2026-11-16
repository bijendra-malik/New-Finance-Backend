const mongoose = require("mongoose");

/*
==========================================
Notification read receipts

Notifications khud kisi collection me store nahi hote — wo admin updates aur
reviews se derive hote hain (single source of truth). Sirf "kis admin ne kaunsi
notification padh li" wala state yahan rehta hai, isliye:

  - duplicate notification nahi banti (key stable hai),
  - read state device badalne par bhi wahi rehti hai,
  - feed ka data purana hone par bhi receipts chhoti rehti hain.

`key` = notification ki stable identity:
  update:<activityRowId>
  review:<reviewKey>

Ek admin ke liye ek key ek hi baar — unique compound index.
==========================================
*/

const MAX_KEY_LENGTH = 200;

const notificationReadSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    key: {
      type: String,
      required: true,
      trim: true,
      maxlength: [MAX_KEY_LENGTH, `Notification key is too long (max ${MAX_KEY_LENGTH})`],
    },

    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

/* Ek admin + ek notification = ek receipt. */
notificationReadSchema.index({ adminId: 1, key: 1 }, { unique: true });

/* "recently read" / cleanup queries ke liye. */
notificationReadSchema.index({ adminId: 1, readAt: -1 });

const NotificationRead = mongoose.model("NotificationRead", notificationReadSchema);

module.exports = { NotificationRead, MAX_KEY_LENGTH };
