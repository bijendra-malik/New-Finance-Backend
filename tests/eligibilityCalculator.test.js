/*
Eligibility calculator — engine + input validation tests.

Pure functions only (no DB): personal loan ke exact numbers, saare rejection
points, ek hi 70% FOIR policy, flat body validation aur route wiring.
*/

const { normalizeInput, productSlug } = require("../src/modules/eligibility/eligibility.input");
const { rateCard, calculateEligibility } = require("../src/modules/eligibility/eligibility.rules");

const personalBody = (overrides = {}) => ({
  product: "personal",
  occupation: "Salaried",
  dob: "1996-01-15",
  monthlyIncome: 80000,
  existingEmi: 0,
  creditScore: 760,
  fullName: "Ravi Kumar",
  mobile: "9876543210",
  email: "ravi@example.com",
  authorized: true,
  ...overrides,
});

const run = (body, pathProduct) => {
  const input = normalizeInput(body, pathProduct);
  const result = calculateEligibility({ product: input.product, inputs: input.inputs });
  return { input, ...result };
};

describe("personal loan eligibility (website parity)", () => {
  it("sanctions the FOIR cap over the product tenure", () => {
    const { outcome } = run(personalBody());

    /* Personal loans use 70% FOIR; ₹80,000 × 70% = ₹56,000 EMI room. */
    expect(outcome.eligible).toBe(true);
    expect(outcome.roi).toBe(12);
    expect(outcome.months).toBe(60);
    expect(outcome.headline).toBe(2517482);
    expect(outcome.monthly).toBe(56000);
    expect(outcome.caps).toEqual([{ key: "foir", label: "Repayment capacity", value: 2517482 }]);
    expect(outcome.binding).toBe("Repayment capacity");
    expect(outcome.credit).toEqual({ score: 760, band: "750 and above, excellent", foirCap: 0.7 });
    /* EMI rounded loan par banti hai, isliye 0.7 ke bilkul barabar nahi. */
    expect(outcome.foir.used).toBeCloseTo(0.7, 3);
  });

  it("keeps the estimate to whole rupees without exceeding EMI capacity", () => {
    const { outcome } = run(personalBody({ monthlyIncome: 16000, existingEmi: 0 }));
    expect(outcome.headline).toBe(503496);
    expect(outcome.monthly).toBe(11200);
    expect(outcome.foir.used).toBeLessThanOrEqual(0.7);
  });
});

describe("personal loan rejection points", () => {
  it.each([
    ["the score is below 650", { creditScore: 620 }, "CREDIT_SCORE_LOW"],
    ["existing EMIs eat the whole income", { monthlyIncome: 20000, existingEmi: 19000, creditScore: 700 }, "NO_EMI_HEADROOM"],
    ["the limit is below the ₹50,000 minimum", { monthlyIncome: 1000, existingEmi: 0, creditScore: 700 }, "BELOW_MIN_LOAN"],
    ["no tenure is left before retirement", { dob: "1966-01-15" }, "AGE_TENURE_OVER"],
  ])("refuses when %s", (_label, overrides, reasonCode) => {
    expect(run(personalBody(overrides)).reasonCode).toBe(reasonCode);
  });

  it("tells the exact point when the score is below 650", () => {
    const { eligible, decision, reasonCode, outcome } = run(personalBody({ creditScore: 620 }));

    expect(eligible).toBe(false);
    expect(decision).toBe("not_eligible");
    expect(reasonCode).toBe("CREDIT_SCORE_LOW");
    expect(outcome.headline).toBe(0);
    expect(outcome.months).toBe(0);
    expect(outcome.message).toContain("below the 650");
  });

  it("asks for a credit score when it is missing", () => {
    expect(() => run(personalBody({ creditScore: "" }))).toThrow("Enter your credit score");
  });

  it("caps the tenure so repayment ends by retirement", () => {
    const { outcome } = run(personalBody({ dob: "1967-01-15" }));
    expect(outcome.eligible).toBe(true);
    expect(outcome.months).toBe(12);
  });
});

describe("shared 70% FOIR policy", () => {
  it.each([
    ["personal", {}],
    ["business", {}],
    ["home", { propertyValue: 5000000 }],
    ["lap", { propertyValue: 5000000 }],
    ["vehicleLoan", { vehiclePrice: 3000000, vehicleFoir: 50 }],
  ])("uses 70%% FOIR for %s across eligible score bands", (product, fields) => {
    for (const creditScore of [650, 700, 750]) {
      const { outcome } = run(personalBody({ product, ...fields, creditScore }));
      expect(outcome.credit.foirCap).toBe(0.7);
    }
  });

  /* Baaki family engines apna FOIR `foir.used` me report karte hain. */
  it.each([
    ["education loan", { product: "educationLoan", eduFees: 10000000 }],
    ["gold loan", { product: "goldLoan", goldGrams: 1000, goldRate: 7000 }],
    ["loan against shares", { product: "loanAgainstShares", shareValue: 10000000 }],
  ])("keeps the 70%% FOIR limit for %s", (_label, fields) => {
    const { outcome } = run(personalBody({ ...fields, monthlyIncome: 80000, existingEmi: 0 }));
    expect(outcome.eligible).toBe(true);
    expect(outcome.foir.used).toBeCloseTo(0.7, 2);
  });

  it("uses fixed 70% FOIR for commercial purchase even when an old override is sent", () => {
    const { outcome } = run(
      personalBody({
        product: "commercialPurchase",
        propertyValue: 20000000,
        monthlyIncome: 100000,
        commercialFoir: 50,
      }),
    );
    expect(outcome.caps).toContainEqual(
      expect.objectContaining({ key: "foir", label: "Repayment capacity at 70% FOIR" }),
    );
  });

  it("prices a business loan at its own rate and tenure", () => {
    const { outcome } = run(personalBody({ product: "business", occupation: "Self Employed - Business" }));
    expect(outcome.eligible).toBe(true);
    expect(outcome.roi).toBe(14);
    expect(outcome.months).toBe(60);
  });
});

describe("business loan yearly income", () => {
  it("takes the yearly income and divides it by 12 for FOIR", () => {
    const yearly = run(personalBody({ product: "business", annualIncome: 900000, monthlyIncome: "" }));
    const monthly = run(personalBody({ product: "business", monthlyIncome: 75000 }));

    expect(yearly.input.inputs.monthlyIncome).toBe(75000);
    expect(yearly.input.inputs.annualIncome).toBe(900000);
    expect(yearly.outcome.headline).toBe(monthly.outcome.headline);
    expect(yearly.outcome.foir.income).toBe(75000);
    expect(yearly.outcome.months).toBe(60);
  });

  it("records the yearly figure when an old monthly value is sent", () => {
    const { input } = run(personalBody({ product: "business", monthlyIncome: 75000 }));
    expect(input.inputs.monthlyIncome).toBe(75000);
    expect(input.inputs.annualIncome).toBe(900000);
  });

  it("asks for the yearly income when the business income is missing", () => {
    let error;
    try {
      normalizeInput(personalBody({ product: "business", monthlyIncome: "" }));
    } catch (caught) {
      error = caught;
    }

    expect(error.errors).toEqual({ annualIncome: "Enter your yearly income" });
  });
});

describe("self-employed yearly income", () => {
    /* Application ke dono self-employed employment types yearly income wale hain. */
  it.each(["Self Employed - Business", "Self Employed - Professional"])("takes the yearly income for a home loan when the occupation is %s",
    (occupation) => {
      const yearly = run(
        personalBody({ product: "home", occupation, propertyValue: 5000000, annualIncome: 900000, monthlyIncome: "" }),
      );
      const monthly = run(
        personalBody({ product: "home", occupation, propertyValue: 5000000, monthlyIncome: 75000 }),
      );

      expect(yearly.input.inputs.monthlyIncome).toBe(75000);
      expect(yearly.input.inputs.annualIncome).toBe(900000);
      expect(yearly.outcome.headline).toBe(monthly.outcome.headline);
    },
  );

  it("keeps a salaried home loan applicant on monthly income", () => {
    const { input } = run(personalBody({ product: "home", occupation: "Salaried", propertyValue: 5000000 }));

    expect(input.inputs.monthlyIncome).toBe(80000);
    expect(input.inputs.annualIncome).toBe(0);
  });

  it.each(["Self Employed - Business", "Self Employed - Professional"])(
    "asks for the yearly income when a %s applicant leaves it blank",
    (occupation) => {
      let error;
      try {
        normalizeInput(
          personalBody({ product: "home", occupation, propertyValue: 5000000, monthlyIncome: "" }),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error.errors).toEqual({ annualIncome: "Enter your yearly income" });
    },
  );
});

describe("input normalization", () => {
  it("treats the statutory personal-loan occupation as salaried", () => {
    const { input } = run(personalBody({ occupation: "Self Employed - Business" }));
    expect(input.inputs.occupation).toBe("Salaried");
  });

  it("accepts the legacy product code and old date format", () => {
    const { input } = run(personalBody({ product: "personal_loan", dob: "15/01/1996" }));
    expect(input.product.key).toBe("personal");
    expect(input.legacyCode).toBe("personal_loan");
    expect(input.applicant.age).toBe(30);
  });

  it("takes the product from the route, not the body", () => {
    const fromPath = run(personalBody({ product: undefined }), "personal");
    expect(fromPath.input.product.key).toBe("personal");
    expect(fromPath.input.legacyCode).toBe("personal_loan");

    /* Body me koi doosra product bheja ho to bhi path hi chalta hai. */
    expect(run(personalBody({ product: "goldLoan" }), "personal").input.product.key).toBe("personal");
  });
});

describe("eligibility input validation", () => {
  it("collects the page's field errors instead of guessing", () => {
    let error;
    try {
      normalizeInput(personalBody({ monthlyIncome: "", mobile: "12345", authorized: false }));
    } catch (caught) {
      error = caught;
    }

    expect(error.statusCode).toBe(400);
    expect(error.errors).toMatchObject({
      monthlyIncome: "Enter your monthly income",
      mobile: "Enter a valid 10-digit mobile number",
      authorized: "Please accept the terms to continue",
    });
  });

  it("rejects an unknown product with the supported list", () => {
    expect(() => normalizeInput(personalBody({ product: "crypto_loan" }))).toThrow(/Unknown loan product/);
  });

  it("rejects a credit score outside 300-900", () => {
    expect(() => normalizeInput(personalBody({ creditScore: 950 }))).toThrow("Credit scores run from 300 to 900");
  });

  it("rejects applicants older than 65", () => {
    expect(() => normalizeInput(personalBody({ dob: "1950-01-15" }))).toThrow(
      "Applicants must be 65 years old or younger",
    );
  });

  it("requires the asset value for a home loan", () => {
    expect(() => normalizeInput(personalBody({ product: "home", propertyValue: "" }))).toThrow(
      "Enter the property market value",
    );
  });
});

describe("family engines", () => {
  it("values a gold loan on LTV slabs and the ₹10,000 floor", () => {
    const input = normalizeInput(
      personalBody({ product: "goldLoan", dob: "1990-01-15", goldGrams: 50, goldRate: 7000 }),
    );
    const { outcome, eligible } = calculateEligibility({ product: input.product, inputs: input.inputs });

    expect(eligible).toBe(true);
    expect(outcome.gold.value).toBe(350000);
    expect(outcome.gold.ltv).toBe(0.8);
    expect(outcome.headline).toBe(280000);
    expect(outcome.months).toBe(12);
  });

  it("prices LRD at 10.5% over the remaining lease", () => {
    const input = normalizeInput(
      personalBody({
        product: "leaseRentalDiscounting",
        dob: "1985-01-15",
        lrdRent: 100000,
        lrdLeaseYears: 5,
        lrdPropertyValue: 10000000,
        lrdLtv: 70,
        creditScore: 780,
      }),
    );
    const { outcome } = calculateEligibility({ product: input.product, inputs: input.inputs });

    expect(outcome.roi).toBe(10.5);
    expect(outcome.months).toBe(60);
    expect(outcome.lease.rentalLimit).toBeLessThan(outcome.lease.propertyLimit);
    expect(outcome.headline).toBe(outcome.lease.rentalLimit);
  });

  it("charges full-draw interest on a working capital limit", () => {
    const input = normalizeInput(
      personalBody({
        product: "workingCapital",
        dob: "1985-01-15",
        turnover: 20000000,
        wcAssessment: 18.75,
        wcMargin: 0,
        creditScore: 780,
      }),
    );
    const { outcome } = calculateEligibility({ product: input.product, inputs: input.inputs });

    expect(outcome.headline).toBe(3750000);
    expect(outcome.monthlyLabel).toBe("Interest at full draw");
    expect(outcome.monthly).toBe(39063);
  });
});

describe("rate card and calculator routes", () => {
  it("exposes the website slug for every product", () => {
    const slugs = rateCard().map((product) => productSlug(product.key));

    expect(slugs).toEqual([
      "personal-loan",
      "business-loan",
      "home-loan",
      "loan-against-property",
      "vehicle-loan",
      "education-loan",
      "project-loan",
      "commercial-purchase",
      "working-capital",
      "lease-rental-discounting",
      "od-cc-limit",
      "gold-loan",
      "loan-against-shares",
    ]);
    expect(new Set(slugs).size).toBe(13);
  });

  it("lists the same 13 products as the website", () => {
    const products = rateCard();
    expect(products).toHaveLength(13);
    expect(products[0]).toMatchObject({ key: "personal", label: "Personal Loan", roi: 12, tenureMonths: 60 });
    expect(products.find((p) => p.key === "goldLoan")).toMatchObject({ minLoan: 10000, tenureMonths: 12 });
    expect(products.find((p) => p.key === "loanAgainstShares")).toMatchObject({ minLoan: 25000 });
  });

  it("registers one POST route per product", () => {
    const paths = require("../src/modules/eligibility/eligibility.routes")
      .stack.filter((layer) => layer.route)
      .map((layer) => layer.route.path);

    expect(paths).toContain("/calculator/personal-loan");
    expect(paths).toContain("/check");
    expect(paths.filter((path) => path.startsWith("/calculator/"))).toHaveLength(13);
  });
});
