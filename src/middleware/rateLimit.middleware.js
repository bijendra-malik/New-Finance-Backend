const rateLimit = require("express-rate-limit");

/*
==========================================
Rate limiters for abuse-prone endpoints.
Keyed by IP (express-rate-limit's default) — per-mobile-number
throttling would need a shared store and is a follow-up, not a
blocker for closing the "no rate limiting at all" gap.
==========================================
*/

// OTP request endpoints (register/login) — these trigger an SMS send per call.
const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests. Please try again later.",
  },
});

// OTP verification endpoints — a few more attempts allowed than requests,
// since a user may mistype the code.
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Please try again later.",
  },
});

// Admin password login — brute-force protection.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
});

// Public location lookup (pincode validate / typeahead / dropdowns) — read-only
// but unauthenticated, so a runaway form loop should not hammer Mongo.
const locationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many location requests. Please try again in a minute.",
  },
});

module.exports = { otpRequestLimiter, otpVerifyLimiter, adminLoginLimiter, locationLimiter };
