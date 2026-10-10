const franchisePlanService = require("../src/modules/franchise/franchisePlan.service");
const {
  createPlanValidator,
  updatePlanValidator,
  setStatusValidator,
} = require("../src/modules/franchise/franchisePlan.validator");
const { franchiseApplyValidator } = require("../src/modules/franchise/franchise.validator");

const {
  withDerivedFields,
  buildPlanView,
  durationLabel,
  normalizeBoolean,
  buildPlanSnapshot,
  DEFAULT_PLANS,
} = franchisePlanService;

/** Runs an express-validator chain (+ the trailing handleValidationErrors) against a fake req. */
const runChain = (chain, body) => {
  const req = { body };
  return new Promise((resolve) => {
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ passed: false, statusCode: this.statusCode, body: payload });
        return this;
      },
    };

    let idx = 0;
    const next = async () => {
      if (idx >= chain.length) {
        resolve({ passed: true, body: req.body });
        return;
      }
      await chain[idx++](req, res, next);
    };
    next();
  });
};

/** A plan document as the service receives it from Mongoose. */
const planDoc = (overrides = {}) => ({
  _id: "plan1",
  code: "3Y",
  name: "3-Year Plan",
  durationMonths: 36,
  fee: 249000,
  currency: "INR",
  gstPercent: 18,
  renewalFee: null,
  renewalNote: "As applicable",
  features: [],
  isBestValue: false,
  isActive: true,
  sortOrder: 1,
  ...overrides,
});

describe("franchise plan derived fields", () => {
  it("computes the GST amount and total from the base fee", () => {
    const plan = withDerivedFields(planDoc({ fee: 249000, gstPercent: 18 }));

    // 249000 + 18% = 293820
    expect(plan.gstAmount).toBe(44820);
    expect(plan.totalWithGst).toBe(293820);
  });

  it("derives the validity label from durationMonths, not from the name", () => {
    expect(durationLabel(36)).toBe("3 Years");
    expect(durationLabel(12)).toBe("1 Year");
    expect(durationLabel(6)).toBe("6 Months");
    expect(durationLabel(1)).toBe("1 Month");

    // Naam kuch bhi ho, label durationMonths se hi banta hai.
    const plan = withDerivedFields(planDoc({ name: "Whatever", durationMonths: 6 }));
    expect(plan.validityLabel).toBe("6 Months");
  });

  it("computes the effective monthly cost that the page quotes", () => {
    expect(withDerivedFields(planDoc({ fee: 249000, durationMonths: 36 })).effectiveMonthlyCost).toBe(
      6916.67
    );
    expect(withDerivedFields(planDoc({ fee: 119000, durationMonths: 12 })).effectiveMonthlyCost).toBe(
      9916.67
    );
    expect(withDerivedFields(planDoc({ fee: 89000, durationMonths: 6 })).effectiveMonthlyCost).toBe(
      14833.33
    );
    expect(withDerivedFields(planDoc({ fee: 59000, durationMonths: 3 })).effectiveMonthlyCost).toBe(
      19666.67
    );
    expect(withDerivedFields(planDoc({ fee: 24000, durationMonths: 1 })).effectiveMonthlyCost).toBe(
      24000
    );
  });

  it("renders renewalText from the fixed fee, else from the note", () => {
    expect(withDerivedFields(planDoc({ renewalFee: 3900 })).renewalText).toBe("₹3,900");
    expect(withDerivedFields(planDoc({ renewalFee: null })).renewalText).toBe("As applicable");
  });
});

describe("franchise plan seed data (what the /franchise page shows)", () => {
  it("ships the five published plans in display order", () => {
    expect(DEFAULT_PLANS.map((plan) => plan.code)).toEqual(["3Y", "1Y", "6M", "3M", "1M"]);
    expect(DEFAULT_PLANS.map((plan) => plan.sortOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the fees GST-exclusive as published", () => {
    const byCode = Object.fromEntries(DEFAULT_PLANS.map((plan) => [plan.code, plan]));

    expect(byCode["3Y"].fee).toBe(249000);
    expect(byCode["1Y"].fee).toBe(119000);
    expect(byCode["6M"].fee).toBe(89000);
    expect(byCode["3M"].fee).toBe(59000);
    expect(byCode["1M"].fee).toBe(24000);
  });

  it("makes the 3-year plan the lowest effective monthly cost — the page's claim", () => {
    const derived = DEFAULT_PLANS.map(withDerivedFields);
    const cheapest = derived.reduce((best, plan) =>
      plan.effectiveMonthlyCost < best.effectiveMonthlyCost ? plan : best
    );

    expect(cheapest.code).toBe("3Y");

    // Aur baaki har plan uska se mehnga ho.
    derived
      .filter((plan) => plan.code !== "3Y")
      .forEach((plan) => {
        expect(plan.effectiveMonthlyCost).toBeGreaterThan(cheapest.effectiveMonthlyCost);
      });
  });

  it("pins 'Best Value' on the 3-year plan and on nothing else", () => {
    expect(DEFAULT_PLANS.filter((plan) => plan.isBestValue).map((plan) => plan.code)).toEqual(["3Y"]);
  });

  it("gives only the 3-year plan a fixed renewal fee", () => {
    const byCode = Object.fromEntries(DEFAULT_PLANS.map((plan) => [plan.code, plan]));

    expect(byCode["3Y"].renewalFee).toBe(3900);
    expect(byCode["3Y"].renewalText).toBeUndefined(); // raw seed data — derived later
    expect(withDerivedFields(byCode["3Y"]).renewalText).toBe("₹3,900");

    ["1Y", "6M", "3M", "1M"].forEach((code) => {
      expect(byCode[code].renewalFee).toBeNull();
      expect(withDerivedFields(byCode[code]).renewalText).toBe("As applicable");
    });
  });
});

describe("franchise plan list view (best value badge)", () => {
  it("uses the plan the admin pinned", () => {
    const view = buildPlanView([
      planDoc({ code: "3Y", fee: 249000, isBestValue: true }),
      planDoc({ code: "1Y", fee: 119000, durationMonths: 12 }),
    ]);

    expect(view.bestValueCode).toBe("3Y");
    expect(view.bestValueIsPinned).toBe(true);
  });

  it("falls back to the lowest effective monthly cost when nothing is pinned", () => {
    const view = buildPlanView([
      planDoc({ code: "1Y", fee: 119000, durationMonths: 12, isBestValue: false }),
      planDoc({ code: "3Y", fee: 249000, durationMonths: 36, isBestValue: false }),
    ]);

    expect(view.bestValueCode).toBe("3Y");
    expect(view.bestValueIsPinned).toBe(false);
  });

  it("returns every plan with its derived fields", () => {
    const view = buildPlanView(DEFAULT_PLANS.map(planDoc));

    expect(view.plans).toHaveLength(5);
    view.plans.forEach((plan) => {
      expect(typeof plan.effectiveMonthlyCost).toBe("number");
      expect(typeof plan.totalWithGst).toBe("number");
      expect(plan.renewalText).toBeTruthy();
    });
  });
});

describe("franchise plan snapshot (apply flow)", () => {
  it("copies the price at apply time instead of just referencing the plan", () => {
    const snapshot = buildPlanSnapshot(
      planDoc({ _id: "507f1f77bcf86cd799439011", code: "3Y", fee: 249000, renewalFee: 3900 })
    );

    expect(snapshot.plan).toBe("507f1f77bcf86cd799439011");
    expect(snapshot.code).toBe("3Y");
    expect(snapshot.fee).toBe(249000);
    expect(snapshot.gstPercent).toBe(18);
    expect(snapshot.totalWithGst).toBe(293820);
    expect(snapshot.renewalFee).toBe(3900);
    expect(snapshot.snapshotAt).toBeInstanceOf(Date);
  });

  it("keeps the frozen price even if the plan is later edited", () => {
    const plan = planDoc({ fee: 249000 });
    const snapshot = buildPlanSnapshot(plan);

    // Admin baad me fee badal deta hai...
    plan.fee = 349000;

    // ...lekin is application ka snapshot wahi rehta hai.
    expect(snapshot.fee).toBe(249000);
  });

  it("returns null when no plan was chosen", () => {
    expect(buildPlanSnapshot(null)).toBeNull();
  });
});

describe("franchise plan boolean handling", () => {
  it("does not treat the string \"false\" as true", () => {
    expect(normalizeBoolean("false", true)).toBe(false);
    expect(normalizeBoolean("true", false)).toBe(true);
    expect(normalizeBoolean(0, true)).toBe(false);
    expect(normalizeBoolean(1, false)).toBe(true);
    expect(normalizeBoolean(undefined, true)).toBe(true);
  });
});

describe("franchise plan admin validators", () => {
  const validPayload = {
    code: "2Y",
    name: "2-Year Plan",
    durationMonths: 24,
    fee: 189000,
  };

  it("accepts a complete plan and normalizes code + numbers", async () => {
    const result = await runChain(createPlanValidator, validPayload);

    expect(result.passed).toBe(true);
    expect(result.body.code).toBe("2Y");
    expect(result.body.durationMonths).toBe(24);
    expect(result.body.fee).toBe(189000);
  });

  it("rejects a plan without a code, name, duration or fee", async () => {
    expect((await runChain(createPlanValidator, { name: "X", durationMonths: 12, fee: 1 })).passed).toBe(
      false
    );
    expect((await runChain(createPlanValidator, { code: "X", durationMonths: 12, fee: 1 })).passed).toBe(
      false
    );
    expect((await runChain(createPlanValidator, { code: "X", name: "X", fee: 1 })).passed).toBe(false);
    expect((await runChain(createPlanValidator, { code: "X", name: "X", durationMonths: 12 })).passed).toBe(
      false
    );
  });

  it("rejects a code with spaces or symbols", async () => {
    expect((await runChain(createPlanValidator, { ...validPayload, code: "3 year" })).passed).toBe(false);
    expect((await runChain(createPlanValidator, { ...validPayload, code: "3Y!" })).passed).toBe(false);
    // Hyphen aur underscore allowed hain.
    expect((await runChain(createPlanValidator, { ...validPayload, code: "3-Y_1" })).passed).toBe(true);
  });

  it("rejects a zero-month duration and a negative fee", async () => {
    expect((await runChain(createPlanValidator, { ...validPayload, durationMonths: 0 })).passed).toBe(
      false
    );
    expect((await runChain(createPlanValidator, { ...validPayload, fee: -1 })).passed).toBe(false);
  });

  it("allows renewalFee to be sent as null (no fixed renewal fee)", async () => {
    const result = await runChain(createPlanValidator, { ...validPayload, renewalFee: null });
    expect(result.passed).toBe(true);
  });

  it("lets an update change just the fee", async () => {
    const result = await runChain(updatePlanValidator, { fee: 259000 });

    expect(result.passed).toBe(true);
    expect(result.body.fee).toBe(259000);
  });

  it("requires isActive on the status endpoint", async () => {
    expect((await runChain(setStatusValidator, {})).passed).toBe(false);
    expect((await runChain(setStatusValidator, { isActive: false })).passed).toBe(true);
  });
});

describe("franchise apply validator (planCode vs legacy package)", () => {
  const base = {
    panNumber: "ABCDE1234F",
    state: "UP",
    city: "Noida",
  };

  it("accepts the new planCode payload", async () => {
    expect((await runChain(franchiseApplyValidator, { ...base, planCode: "3Y" })).passed).toBe(true);
  });

  it("still accepts the legacy package payload", async () => {
    expect((await runChain(franchiseApplyValidator, { ...base, package: "Premium" })).passed).toBe(true);
  });

  it("rejects an application with no plan and no package", async () => {
    const result = await runChain(franchiseApplyValidator, base);

    expect(result.passed).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it("rejects a malformed plan code", async () => {
    expect((await runChain(franchiseApplyValidator, { ...base, planCode: "3 year" })).passed).toBe(false);
  });

  it("keeps the PAN / state / city rules working", async () => {
    expect(
      (await runChain(franchiseApplyValidator, { ...base, planCode: "3Y", panNumber: "BADPAN" })).passed
    ).toBe(false);
    expect(
      (await runChain(franchiseApplyValidator, { ...base, planCode: "3Y", state: "" })).passed
    ).toBe(false);
    expect(
      (await runChain(franchiseApplyValidator, { ...base, planCode: "3Y", city: "  " })).passed
    ).toBe(false);
  });
});
