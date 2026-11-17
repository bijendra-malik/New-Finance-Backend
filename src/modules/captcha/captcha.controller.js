const captchaService = require("./captcha.service");

/*
==========================================
Human verification controllers

  GET  /api/captcha/new      — naya sawaal
  POST /api/captcha/verify   — answer check, sahi par token
==========================================
*/

/* New challenge */
exports.create = (req, res) => {
  res.json({ success: true, captcha: captchaService.newChallenge() });
};

/* Verify answer */
exports.verify = (req, res) => {
  const { id, answer } = req.body || {};
  const result = captchaService.verifyChallenge({ id, answer });

  if (result.status === "ok") {
    return res.json({
      success: true,
      message: "Verified. You can submit the form now.",
      token: result.token,
      expiresIn: result.expiresIn,
    });
  }

  if (result.status === "expired") {
    return res.status(410).json({
      success: false,
      code: "CAPTCHA_EXPIRED",
      message: "This check expired. Please request a new question.",
    });
  }

  if (result.status === "locked") {
    return res.status(400).json({
      success: false,
      code: "CAPTCHA_ATTEMPTS_EXCEEDED",
      message: "Too many wrong answers. Please solve this new question.",
      captcha: result.captcha,
    });
  }

  return res.status(400).json({
    success: false,
    code: "CAPTCHA_WRONG_ANSWER",
    message: "That answer is not correct. Please try again.",
    attemptsLeft: result.attemptsLeft,
  });
};
