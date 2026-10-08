/*
==========================================
MOCK CIBIL provider (default).

Real bureau (CIBIL / Experian / CRIF / koi aggregator) ke credentials aane se
pehle development aur tests isi provider par chalte hain.

Score deterministic hai — PAN ke characters ka sum lekar 550-850 ke beech map
karta hai — isliye dev me same PAN par hamesha same score aata hai.

Test/demo ke liye ek PAN ka score force karna ho to:
  CIBIL_MOCK_SCORE=580   -> har check 580 dega (low-score / locked case test karne ke liye)
==========================================
*/

const scoreFromPan = (panNumber) => {
  const seed = String(panNumber || "")
    .toUpperCase()
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);

  // 550 .. 850
  return 550 + (seed % 301);
};

const makeReferenceId = () => `MOCK-${Date.now().toString(36).toUpperCase()}`;

module.exports = {
  name: "mock",

  /**
   * Provider contract (har provider yahi shape return karta hai):
   *   { success: true,  score, bureau, referenceId }
   *   { success: false, failureReason }
   *
   * Input: { panNumber, fullName, mobile, dob }
   */
  async fetchScore({ panNumber }) {
    const forced = Number(process.env.CIBIL_MOCK_SCORE);
    const score = Number.isFinite(forced) && forced > 0 ? forced : scoreFromPan(panNumber);

    return {
      success: true,
      score,
      bureau: "MOCK",
      referenceId: makeReferenceId(),
    };
  },
};
