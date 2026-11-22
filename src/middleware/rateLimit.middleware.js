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

/*
Admin password login — brute-force protection.

Sirf FAILED attempts gine jaate hain (`skipSuccessfulRequests`): sahi password
se login karne par counter wapas kam ho jata hai, isliye team testing / baar
baar login karna kabhi block nahi hota — par galat password guess karne par
10 attempts ke baad 15 minute ka lockout pehle jaisa hi rehta hai.
*/
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again in a few minutes.",
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

/*
Public contact form — ek IP se 10 minute me 20 enquiries kaafi zyada hain, isliye
thoda tight. Asli user 1-2 baar hi submit karta hai; ye sirf scripted spam rokta
hai (dedupe alag se contact.service me hai).
*/
const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many enquiries from this device. Please try again in a few minutes.",
  },
});

// Public captcha (new + verify) — har form submit me 2 calls lagti hain, isliye
// 10 minute me 60. Isse zyada ka matlab script hai, insaan nahi.
const captchaLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification attempts. Please try again in a few minutes.",
  },
});

/*
Public eligibility calculator — har submit par ek DB write hota hai, isliye
contact form jaisa hi tight budget: 10 minute me 30 checks ek IP se. Insaan
2-3 baar hi check karta hai; ye scripted spam rokta hai (dedupe service me
hai — 1 minute ke andar same input dobara aane par naya row nahi banta).
*/
const eligibilityLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many eligibility checks from this device. Please try again in a few minutes.",
  },
});

module.exports = {
  otpRequestLimiter,
  otpVerifyLimiter,
  adminLoginLimiter,
  locationLimiter,
  contactLimiter,
  captchaLimiter,
  eligibilityLimiter,
};
