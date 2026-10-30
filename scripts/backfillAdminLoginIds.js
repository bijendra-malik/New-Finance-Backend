require("../src/config/env");

const mongoose = require("mongoose");

const connectDB = require("../src/config/database");
const Admin = require("../src/modules/admin/admin.model");

/*
==========================================
Backfill admin `loginId`

Team & Access se banaye admins ka `loginId` save hota hai, lekin purane
accounts (jinme ye field nahi thi) sirf email rakhte hain. Login ab email ya
loginId dono accept karta hai, isliye purane accounts ka handle email ke local
part se ek baar set kar dete hain.

Idempotent: jinka loginId already hai unhe chhua nahi jata.
Usage: node scripts/backfillAdminLoginIds.js [--dry-run]
==========================================
*/

const dryRun = process.argv.includes("--dry-run");

const run = async () => {
  await connectDB();

  const admins = await Admin.find({ loginId: { $in: [null, undefined] } }).sort({
    createdAt: 1,
  });

  console.log("=================================");
  console.log(`🔎 Admins without loginId: ${admins.length}`);
  console.log("=================================");

  let updated = 0;

  for (const admin of admins) {
    const handle = String(admin.email).split("@")[0].toLowerCase();
    const clash = await Admin.findOne({ loginId: handle, _id: { $ne: admin._id } });
    const next = clash ? `${handle}.${String(admin._id).slice(-4)}` : handle;

    console.log(`${dryRun ? "•" : "✅"} ${admin.email} -> ${next}`);
    if (!dryRun) {
      admin.loginId = next;
      await admin.save();
    }
    updated += 1;
  }

  console.log("=================================");
  console.log(`${dryRun ? "Would update" : "Updated"}: ${updated}`);
  console.log("=================================");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((error) => {
  console.error("❌ Backfill failed:", error.message);
  process.exit(1);
});
