const {
  MIN_CREDIT_SCORE,
  applyCreditScore,
  creditStatus,
  creditSnapshot,
  assertLoanEligibility,
} = require("../src/modules/customer/credit.service");
const { AUTO_REJECTED_TTL_SECONDS } = require("../src/modules/loans/shared/loanSchema");

const account = (overrides = {}) => ({
  creditScore: null,
  creditScoreCheckedAt: null,
  creditEligible: false,
  creditEligibilityExpiresAt: null,
  ...overrides,
});

describe("credit score eligibility", () => {
  it("retains auto-rejected records for the same three-day reapply window", () => {
    expect(AUTO_REJECTED_TTL_SECONDS).toBe(3 * 24 * 60 * 60);
  });

  it("marks a score below 600 as not eligible and starts no window", () => {
    const user = account();
    const result = applyCreditScore(user, 599);

    expect(result.creditScore).toBe(599);
    expect(result.eligible).toBe(false);
    expect(result.expiresAt).toBeNull();
    expect(result.remainingSeconds).toBe(0);
    expect(user.creditEligible).toBe(false);
    expect(result.message).toContain("below 600");
  });

  it("treats 600 as eligible and starts a 24-hour window", () => {
    const user = account();
    const before = Date.now();
    const result = applyCreditScore(user, MIN_CREDIT_SCORE);

    expect(result.eligible).toBe(true);
    expect(result.creditScore).toBe(600);
    expect(result.expiresAt).toBeTruthy();
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000);
    expect(result.remainingSeconds).toBeGreaterThan(86000);
  });

  it("starts a fresh 24-hour window on every qualifying re-check", () => {
    const user = account({
      creditScore: 700,
      creditScoreCheckedAt: new Date(Date.now() - 23 * 60 * 60 * 1000),
      creditEligible: true,
      creditEligibilityExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const result = applyCreditScore(user, 700);
    expect(result.remainingSeconds).toBeGreaterThan(86000);
  });

  it("snapshots the score checked for one application, so a later re-check cannot rewrite it", () => {
    const user = account();
    applyCreditScore(user, 650);
    const homeLoanSnapshot = creditSnapshot(user);

    /* Customer re-checks before applying for the next product. */
    applyCreditScore(user, 700);
    const businessLoanSnapshot = creditSnapshot(user);

    expect(homeLoanSnapshot.creditScore).toBe(650);
    expect(homeLoanSnapshot.creditEligible).toBe(true);
    expect(homeLoanSnapshot.creditScoreCheckedAt).toBeInstanceOf(Date);
    expect(homeLoanSnapshot.creditEligibilityExpiresAt).toBeTruthy();

    expect(businessLoanSnapshot.creditScore).toBe(700);
    expect(user.creditScore).toBe(700);
  });

  it("returns no snapshot until the customer checks a score", () => {
    expect(creditSnapshot(account())).toBeNull();
  });

  it("rejects scores outside 300-900", () => {
    expect(() => applyCreditScore(account(), 299)).toThrow("between 300 and 900");
    expect(() => applyCreditScore(account(), 901)).toThrow("between 300 and 900");
    expect(() => applyCreditScore(account(), 650.5)).toThrow("between 300 and 900");
  });

  it("reports an expired window separately from a low score", () => {
    const user = account({
      creditScore: 700,
      creditScoreCheckedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      creditEligible: true,
      creditEligibilityExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const status = creditStatus(user);
    expect(status.eligible).toBe(false);
    expect(status.expired).toBe(true);
    expect(status.remainingSeconds).toBe(0);
  });

  it("blocks apply until the score is checked", () => {
    expect(() => assertLoanEligibility(account())).toThrow(
      "Please check your credit score before applying for a loan."
    );
  });

  it("blocks apply when the score is below 600", () => {
    const user = account();
    applyCreditScore(user, 599);

    expect(() => assertLoanEligibility(user)).toThrow("Your credit score is below 600");
  });

  it("blocks apply after the 24-hour window expires", () => {
    const user = account({
      creditScore: 700,
      creditScoreCheckedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      creditEligible: true,
      creditEligibilityExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    expect(() => assertLoanEligibility(user)).toThrow("24-hour application window has expired");
  });

  it("allows apply inside the 24-hour window", () => {
    const user = account();
    applyCreditScore(user, 720);

    expect(assertLoanEligibility(user)).toBe(true);
  });
});
