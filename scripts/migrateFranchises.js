require("dotenv").config();

const mongoose = require("mongoose");

const connectDB = require("../src/config/database");
const { USER_ROLE } = require("../src/constants/roles");

/*
==========================================
Migrate existing franchise accounts: `users` -> `franchises`.

Franchise ab apni collection me rehti hai. Purane franchise documents `users`
me pade hain, unhe yahan le aate hain — password hash sameta, kyunki wo
`.select("+password")` ke bina nahi milta.

Safe by default:
  - kuch bhi DELETE nahi hota (originals waise hi rehte hain)
  - upsert mobile par hota hai, isliye dobara chalana bhi safe hai (idempotent)

Usage:
  node scripts/migrateFranchises.js                     # copy only (report)
  node scripts/migrateFranchises.js --delete-originals  # copy + users se hata do
==========================================
*/

const shouldDeleteOriginals = process.argv.includes("--delete-originals");

const run = async () => {
  await connectDB();

  // Native collection reads: password `select: false` hai, aur hume HAR field
  // chahiye — isliye model ke bajaye seedha collection padhte hain.
  const users = mongoose.connection.collection("users");
  const franchises = mongoose.connection.collection("franchises");

  const legacyFranchises = await users.find({ role: USER_ROLE.FRANCHISE }).toArray();

  console.log("=================================");
  console.log(`🔎 users collection me franchise documents: ${legacyFranchises.length}`);
  console.log("=================================");

  if (!legacyFranchises.length) {
    console.log("✅ Kuch migrate karne ko nahi hai.");
    await mongoose.connection.close();
    process.exit(0);
  }

  let created = 0;
  let updated = 0;

  for (const doc of legacyFranchises) {
    const { _id, ...fields } = doc;

    // role franchise collection me fixed hai — chhod do.
    delete fields.role;
    // LastLogin/createdAt/updatedAt preserve karo; warna mongoose dates set kar dega.
    delete fields.createdAt;
    delete fields.updatedAt;

    const existing = await franchises.findOne({ mobile: fields.mobile });

    if (existing) {
      await franchises.updateOne({ _id: existing._id }, { $set: fields });
      updated += 1;
      continue;
    }

    // Naya document: ek hi ObjectId rakho, taaki purane loans ka
    // `franchise: <id>` reference toot na jaye (native insert use kar rahe hain
    // kyunki hume har field — password hash sameta — as-is chahiye).
    await franchises.insertOne({
      _id,
      ...fields,
      role: USER_ROLE.FRANCHISE,
      createdAt: doc.createdAt || new Date(),
      updatedAt: new Date(),
    });
    created += 1;
  }

  console.log(`✅ Franchise documents copied: ${created} naye, ${updated} update`);
  console.log(`   (${legacyFranchises.length} purane documents users me hai)`);

  if (shouldDeleteOriginals) {
    const cleanup = await users.deleteMany({ role: USER_ROLE.FRANCHISE });
    console.log(`🧹 users se hataaye gaye franchise documents: ${cleanup.deletedCount}`);
  } else {
    console.log("");
    console.log("ℹ️  users collection abhi waise hi hai (non-destructive).");
    console.log("   Originals hatane ke liye: node scripts/migrateFranchises.js --delete-originals");
  }

  console.log("=================================");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (error) => {
  console.error("❌ Migration failed:", error.message);
  try {
    await mongoose.connection.close();
  } catch (closeError) {
    // ignore
  }
  process.exit(1);
});
