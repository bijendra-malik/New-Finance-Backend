const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    try {
      await mongoose.connection.collection("otps").dropIndex("expiresAt_1");
      console.log("✅ Removed OTP expiration index");
    } catch (error) {
      if (error.code !== 26 && error.code !== 27) throw error;
    }

    console.log("=================================");
    console.log("✅ MongoDB Connected Successfully");
    console.log("=================================");
  } catch (error) {
    console.error("=================================");
    console.error("❌ MongoDB Connection Failed");
    console.error(error.message);
    console.error("=================================");

    process.exit(1);
  }
};

module.exports = connectDB;