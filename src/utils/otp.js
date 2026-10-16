/*
==========================================
OTP helpers — entry (`POST /api/auth/:product`) aur status door
(`POST /api/status`) dono inhi ka use karte hai.

`freshOtp()` testing ke liye `.env` ka `STATIC_OTP` respect karta hai, aur
`maskMobile()` response me poora mobile number kabhi wapas nahi bhejne deta.
==========================================
*/

/** 6-digit OTP — `.env` me `STATIC_OTP` ho to wahi (testing ke liye). */
const freshOtp = () =>
  process.env.STATIC_OTP || Math.floor(100000 + Math.random() * 900000).toString();

/** "9876543210" -> "98******10" (response me dikhane ke liye). */
const maskMobile = (mobile) => {
  const value = String(mobile ?? "").trim();
  if (value.length < 4) return value;
  return `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`;
};

module.exports = { freshOtp, maskMobile };
