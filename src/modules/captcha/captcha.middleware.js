const captchaService = require("./captcha.service");

/*
==========================================
requireCaptcha — protected form endpoint ke liye guard

Use:
  router.post("/", requireCaptcha, controller.create);

Token `req.body.captchaToken` se ya `x-captcha-token` header se aata hai.
Token single-use hai: ek token = ek submit. Replay par 400 milta hai.
==========================================
*/

const MESSAGES = {
  invalid: "Human verification is invalid. Please verify again.",
  expired: "Human verification expired. Please verify again.",
  used: "Human verification already used. Please verify again.",
};

module.exports = (req, res, next) => {
  const token = req.body?.captchaToken || req.get("x-captcha-token");

  if (!token) {
    return res.status(400).json({
      success: false,
      code: "CAPTCHA_REQUIRED",
      message: "Please confirm you are not a robot before submitting.",
    });
  }

  const result = captchaService.consumeToken(String(token));

  if (!result.ok) {
    return res.status(400).json({
      success: false,
      code: "CAPTCHA_INVALID",
      message: MESSAGES[result.reason] || MESSAGES.invalid,
    });
  }

  /*
  Token body me hi aa sakta hai — aage service layer tak na pahunche, warna
  payload validation me extra field ki shikayat aayegi.
  */
  if (req.body && typeof req.body === "object" && "captchaToken" in req.body) {
    delete req.body.captchaToken;
  }

  return next();
};
