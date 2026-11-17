const router = require("express").Router();

const captchaController = require("./captcha.controller");
const { captchaLimiter } = require("../../middleware/rateLimit.middleware");

/*
==========================================
Public human-verification API — /api/captcha

  GET  /new       naya calculation sawaal (2 minute valid)
  POST /verify    { id, answer } → sahi par single-use token (10 minute)

Frontend flow:
  1. "I am not a robot" tick  → GET /new
  2. sawaal solve karke       → POST /verify
  3. token form submit ke saath bhejo (`captchaToken`)

Form endpoint par `requireCaptcha` middleware lagao (captcha.middleware.js),
warna token banane ka fayda nahi — bina token ke bhi submit chalta rahega.
==========================================
*/

router.get("/new", captchaLimiter, captchaController.create);

router.post("/verify", captchaLimiter, captchaController.verify);

module.exports = router;
