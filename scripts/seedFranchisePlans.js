require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../src/config/database");
const FranchisePlan = require("../src/modules/franchise/franchisePlan.model");
const { DEFAULT_PLANS } = require("../src/modules/franchise/franchisePlan.service");

/*
==========================================
Franchise investment plans seed.

Ye wahi 5 plans hain jo /franchise page par hardcoded the — ab ye admin-managed
documents ban gaye hain.

`$setOnInsert` jaan-boojh kar use kiya hai (seedMasters.js `$set` lagata hai):
plans admin edit karta hai, isliye seed dobara chalane par uske badle hue fee ya
validity overwrite nahi hone chahiye. Seed sirf missing plan banata hai.

Chalane ke liye:  npm run seed:franchise-plans
==========================================
*/

const run = async () => {
  await connectDB();

  let inserted = 0;

  for (const plan of DEFAULT_PLANS) {
    const result = await FranchisePlan.updateOne(
      { code: plan.code },
      { $setOnInsert: plan },
      { upsert: true }
    );

    if (result.upsertedCount) {
      inserted += 1;
      console.log(`✓ Seeded franchise plan: ${plan.code} — ${plan.name}`);
    } else {
      console.log(`• Skipped (already exists): ${plan.code} — ${plan.name}`);
    }
  }

  /*
  "Best Value" badge sirf ek plan par rehta hai. Agar admin ne pehle se kisi
  plan par pin kiya hua hai to usko chhedte nahi — sirf tab set karte hain jab
  koi badge hi nahi hai, taaki page par badge kabhi gaayab na ho.
  */
  const pinned = await FranchisePlan.countDocuments({ isBestValue: true });

  if (pinned === 0) {
    const bestValue = DEFAULT_PLANS.find((plan) => plan.isBestValue);
    if (bestValue) {
      await FranchisePlan.updateOne({ code: bestValue.code }, { $set: { isBestValue: true } });
      console.log(`✓ Best Value badge set on: ${bestValue.code}`);
    }
  } else {
    console.log("• Best Value badge already set — left unchanged");
  }

  const total = await FranchisePlan.countDocuments();

  console.log("=================================");
  console.log(`✅ ${inserted} plan(s) inserted · ${total} total franchise plan(s)`);
  console.log("=================================");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((error) => {
  console.error("❌ Failed to seed franchise plans:", error.message);
  process.exit(1);
});
