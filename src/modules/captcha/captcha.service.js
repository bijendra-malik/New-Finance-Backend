const crypto = require("crypto");

/*
==========================================
Human verification (captcha) service

  Do hisse:
  1. Challenge  — chhota calculation ("42 + 17", dono numbers 10–99), 2 minute
                  valid, 3 attempts.
  2. Token      — sahi answer par issue hota hai; form submit isi token ke saath
                  aata hai aur token single-use hota hai (10 minute valid).

Store in-memory hai (Map), DB collection nahi — koi migration nahi chahiye.
Trade-off: server restart par pending challenges/tokens khatam ho jaate hain,
isliye user ko dobara tick karna padta hai. Ek hi instance (Render) par ye
theek hai; multi-instance par shared store (Redis/DB) chahiye hoga.

Answer kabhi response me nahi jaata, na log hota hai.
==========================================
*/

const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 3;
const MAX_CHALLENGES = 5000; // memory guard

const challenges = new Map(); // id -> { answer, attemptsLeft, expiresAt }
const tokens = new Map(); // jti -> { expiresAt, used }

/*
Secret challenge/token signature ke liye. Khaas env var na ho to JWT_SECRET
use hota hai; dono na hon to process-level random secret banta hai (restart par
tokens invalid ho jaate hain, jo safe default hai).
*/
const SECRET =
  process.env.CAPTCHA_SECRET ||
  process.env.JWT_SECRET ||
  crypto.randomBytes(32).toString("hex");

const randomInt = (min, max) => crypto.randomInt(min, max + 1);

/* Purane entries hatao — warna Map badhta rehta hai. */
const prune = () => {
  const now = Date.now();

  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt <= now) challenges.delete(id);
  }

  for (const [jti, token] of tokens) {
    if (token.expiresAt <= now) tokens.delete(jti);
  }

  // Sabse purane challenges pehle nikaalo.
  if (challenges.size > MAX_CHALLENGES) {
    const extra = challenges.size - MAX_CHALLENGES;
    let removed = 0;

    for (const id of challenges.keys()) {
      challenges.delete(id);
      if (++removed >= extra) break;
    }
  }
};

/* Background cleanup — server band hone par timer bhi ruk jaata hai. */
const janitor = setInterval(prune, 60 * 1000);

if (typeof janitor.unref === "function") janitor.unref();

const newChallenge = () => {
  const id = crypto.randomUUID();

  /*
  Kabhi addition, kabhi subtraction. Subtraction me answer negative nahi aata
  (b < a), kyunki "-" wale chhote sawaal par typo zyada hoti hai.

  Dono numbers two-digit hote hain (10 se 99), single digit nahi. Subtraction
  me pehla number kam se kam 20 rakha jaata hai taaki doosra bhi 10 se shuru
  ho — yaani dono operands 10–99 ke beech rahein.
  */
  const subtraction = randomInt(0, 1) === 1;

  let question;
  let answer;

  if (subtraction) {
    const a = randomInt(20, 99);
    const b = randomInt(10, a - 1);
    question = `${a} - ${b}`;
    answer = a - b;
  } else {
    const a = randomInt(10, 99);
    const b = randomInt(10, 99);
    question = `${a} + ${b}`;
    answer = a + b;
  }

  challenges.set(id, {
    answer,
    attemptsLeft: MAX_ATTEMPTS,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });

  prune();

  return {
    id,
    question,
    expiresIn: CHALLENGE_TTL_MS / 1000,
    attempts: MAX_ATTEMPTS,
  };
};

const signToken = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");

  return `${body}.${mac}`;
};

const readToken = (token) => {
  if (typeof token !== "string" || !token.includes(".")) return null;

  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");

  const a = Buffer.from(mac || "");
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

/*
Answer check.
Return: { status: "ok", token, expiresIn }
      | { status: "wrong", attemptsLeft }
      | { status: "locked", captcha }   (3 galat — naya sawaal)
      | { status: "expired" }
*/
const verifyChallenge = ({ id, answer }) => {
  const challenge = id ? challenges.get(String(id)) : null;

  if (!challenge || challenge.expiresAt <= Date.now()) {
    if (id) challenges.delete(String(id));
    return { status: "expired" };
  }

  /*
  Sirf digits accept hote hain: `true`, `[]`, `""` ya `"7.5"` jaisa kuch bhi
  accidental match nahi bana sakta (pehle `Number(true)` = 1 ho jaata tha).
  */
  const raw = String(answer ?? "").trim();
  const correct = /^\d{1,3}$/.test(raw) && Number(raw) === challenge.answer;

  if (!correct) {
    challenge.attemptsLeft -= 1;

    if (challenge.attemptsLeft <= 0) {
      challenges.delete(String(id));
      return { status: "locked", captcha: newChallenge() };
    }

    return { status: "wrong", attemptsLeft: challenge.attemptsLeft };
  }

  // Sahi answer — challenge single-use hai.
  challenges.delete(String(id));

  const jti = crypto.randomUUID();
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  tokens.set(jti, { expiresAt, used: false });

  return {
    status: "ok",
    token: signToken({ jti, exp: expiresAt }),
    expiresIn: TOKEN_TTL_MS / 1000,
  };
};

/*
Token ko ek baar kharch karo. Middleware ise form endpoints par lagata hai.
Return: { ok: true } | { ok: false, reason: "invalid" | "expired" | "used" }
*/
const consumeToken = (token) => {
  const payload = readToken(token);

  if (!payload?.jti || !payload?.exp) return { ok: false, reason: "invalid" };
  if (payload.exp <= Date.now()) return { ok: false, reason: "expired" };

  const entry = tokens.get(payload.jti);

  if (!entry) return { ok: false, reason: "invalid" };
  if (entry.used) return { ok: false, reason: "used" };

  entry.used = true;

  return { ok: true };
};

module.exports = {
  newChallenge,
  verifyChallenge,
  consumeToken,
  CHALLENGE_TTL_SECONDS: CHALLENGE_TTL_MS / 1000,
  TOKEN_TTL_SECONDS: TOKEN_TTL_MS / 1000,
  MAX_ATTEMPTS,
};
