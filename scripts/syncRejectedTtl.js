/*
==========================================
Rule-based rejections ka TTL index sync karta hai.

MongoDB schema change se purana index apne aap update nahi hota — agar
collection me pehle se `autoRejectedAt` ka TTL index kisi purane window
(jaise 3 din) par bana hua hai, to usi window par delete hota rahega.
Ye script har loan collection ka index dekhkar, window badla hua hone par
usko drop karke naya index (loanSchema.js wali value ke saath) bana deta hai.

Chalane ka tarika:  npm run sync:rejected-ttl
==========================================
*/

require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../src/config/database");
const { AUTO_REJECTED_TTL_SECONDS } = require("../src/modules/loans/shared/loanSchema");

const TARGET_SECONDS = AUTO_REJECTED_TTL_SECONDS;

const run = async () => {
  await connectDB();

  const { db } = mongoose.connection;
  const collections = await db.listCollections().toArray();
  let updated = 0;

  for (const { name } of collections) {
    const collection = db.collection(name);

    const indexes = await collection.indexes().catch(() => []);
    const ttlIndex = indexes.find(
      (index) => index.key && index.key.autoRejectedAt === 1 && index.expireAfterSeconds !== undefined
    );

    // Sirf un collections ko chhedte hain jahan TTL index pehle se hai.
    if (!ttlIndex) continue;

    if (ttlIndex.expireAfterSeconds === TARGET_SECONDS) {
      console.log(`= ${name}: already ${TARGET_SECONDS}s`);
      continue;
    }

    await collection.dropIndex(ttlIndex.name);
    await collection.createIndex({ autoRejectedAt: 1 }, { expireAfterSeconds: TARGET_SECONDS });
    updated += 1;
    console.log(
      `✅ ${name}: ${ttlIndex.expireAfterSeconds}s -> ${TARGET_SECONDS}s (${TARGET_SECONDS / 86400} din)`
    );
  }

  console.log("=================================");
  console.log(`✅ TTL sync done — ${updated} collection(s) updated`);
  console.log("=================================");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (error) => {
  console.error("❌ TTL sync failed:", error.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
