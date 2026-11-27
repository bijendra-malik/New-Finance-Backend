const nodemailer = require("nodemailer");

let transporter = null;

/*
==========================================
Lazily builds the SMTP transporter. Returns null when SMTP env vars
aren't configured yet, so callers can fall back to a safe dev log
instead of crashing (mirrors utils/sendOTP.js).
==========================================
*/
const getTransporter = () => {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
};

const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const t = getTransporter();

    if (!t) {
      if (process.env.NODE_ENV !== "production") {
        console.log("====================================");
        console.log("📧 Sending Email (SMTP not configured — logging instead)...");
        console.log("To      :", to);
        console.log("Subject :", subject);
        console.log("Body    :", text || html);
        console.log("====================================");
      }
      return true;
    }

    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      text,
    });

    return true;
  } catch (error) {
    console.log("Email Send Error :", error.message);
    return false;
  }
};

module.exports = sendEmail;
