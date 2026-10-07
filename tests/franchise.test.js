const { registerValidator } = require("../src/modules/auth/auth.validator");
const {
  franchiseLoginValidator,
  franchiseApplyValidator,
} = require("../src/modules/franchise/franchise.validator");
const {
  requireCustomer,
  requireFranchise,
  loadFranchise,
} = require("../src/middleware/franchise.middleware");
const { formatId } = require("../src/utils/sequence");
const { productKeyFromParam } = require("../src/modules/loans/shared/productApplyValidator");
const adminFranchiseService = require("../src/modules/admin/franchise.service");
const { buildLoanDocument } = require("../src/modules/loans/shared/loan.service");
const { USER_ROLE } = require("../src/constants/roles");

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
        resolve({ passed: true });
        return;
      }
      await chain[idx++](req, res, next);
    };
    next();
  });
};

describe("authValidators.registerValidator (role aware)", () => {
  it("accepts a franchise registration with role + location", async () => {
    const result = await runChain(registerValidator, {
      role: "Franchise",
      continent: "Asia",
      country: "India",
      name: "Amit",
      mobile: "9876543222",
      email: "amit@example.com",
    });
    expect(result.passed).toBe(true);
  });

  it("accepts a customer registration with role + location", async () => {
    const result = await runChain(registerValidator, {
      role: "Customer",
      continent: "Asia",
      country: "India",
      name: "Rahul",
      mobile: "9876543210",
      email: "rahul@example.com",
    });
    expect(result.passed).toBe(true);
  });

  it("still accepts the legacy name/mobile/email-only payload", async () => {
    const result = await runChain(registerValidator, {
      name: "Legacy",
      mobile: "9876543210",
      email: "legacy@example.com",
    });
    expect(result.passed).toBe(true);
  });

  it("rejects an unknown role", async () => {
    const result = await runChain(registerValidator, {
      role: "Admin",
      name: "Bad",
      mobile: "9876543210",
      email: "bad@example.com",
    });
    expect(result.passed).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe("franchise validators", () => {
  it("login requires franchiseId + password", async () => {
    expect((await runChain(franchiseLoginValidator, { franchiseId: "FRN000125" })).passed).toBe(false);
    expect(
      (await runChain(franchiseLoginValidator, { franchiseId: "FRN000125", password: "9876543210" })).passed
    ).toBe(true);
  });

  it("apply requires a valid PAN, state, city, package", async () => {
    expect(
      (
        await runChain(franchiseApplyValidator, {
          panNumber: "BADPAN",
          state: "UP",
          city: "Noida",
          package: "Premium",
        })
      ).passed
    ).toBe(false);

    expect(
      (
        await runChain(franchiseApplyValidator, {
          panNumber: "ABCDE1234F",
          state: "UP",
          city: "Noida",
          package: "Premium",
        })
      ).passed
    ).toBe(true);
  });
});

describe("franchise middleware role guards", () => {
  const run = (middleware, user) =>
    new Promise((resolve) => {
      const req = { user };
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          resolve({ allowed: false, statusCode: this.statusCode, payload });
        },
      };
      middleware(req, res, () => resolve({ allowed: true, req }));
    });

  it("requireCustomer blocks a Franchise token", async () => {
    const result = await run(requireCustomer, { role: USER_ROLE.FRANCHISE });
    expect(result.allowed).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("requireCustomer allows a Customer token", async () => {
    expect((await run(requireCustomer, { role: USER_ROLE.CUSTOMER })).allowed).toBe(true);
    // Legacy accounts ("User") are treated as customers.
    expect((await run(requireCustomer, { role: USER_ROLE.LEGACY_CUSTOMER })).allowed).toBe(true);
  });

  it("requireFranchise blocks a Customer token", async () => {
    expect((await run(requireFranchise, { role: USER_ROLE.CUSTOMER })).allowed).toBe(false);
  });

  it("requireFranchise allows a Franchise token", async () => {
    expect((await run(requireFranchise, { role: USER_ROLE.FRANCHISE })).allowed).toBe(true);
  });

  it("loadFranchise rejects a Customer token with the role message (before any DB read)", async () => {
    const result = await run(loadFranchise, { role: USER_ROLE.CUSTOMER });
    expect(result.allowed).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.payload.message).toMatch(/franchise accounts only/i);
  });
});

describe("productKeyFromParam (product in the URL path)", () => {
  it("accepts the config key, the key + loan, and the kebab-case form", () => {
    expect(productKeyFromParam("personal")).toBe("personal");
    expect(productKeyFromParam("personalloan")).toBe("personal");
    expect(productKeyFromParam("personal-loan")).toBe("personal");
    expect(productKeyFromParam("businessloan")).toBe("business");
    expect(productKeyFromParam("gold-loan")).toBe("goldLoan");
    expect(productKeyFromParam("credit-card")).toBe("creditCard");
  });

  it("accepts the human loanType, so long names work too", () => {
    expect(productKeyFromParam("loan-against-property")).toBe("lap");
    expect(productKeyFromParam("od-cc-limit")).toBe("odCcLimit");
    expect(productKeyFromParam("working-capital")).toBe("workingCapital");
    expect(productKeyFromParam("lease-rental-discounting")).toBe("leaseRentalDiscounting");
  });

  it("returns null for an unknown product", () => {
    expect(productKeyFromParam("wrongproduct")).toBeNull();
    expect(productKeyFromParam("")).toBeNull();
  });
});

describe("utils/sequence", () => {
  it("pads ids to the fixed width", () => {
    expect(formatId("FRN", 125)).toBe("FRN000125");
    expect(formatId("LOAN", 1)).toBe("LOAN000001");
  });
});

describe("admin franchise credentials", () => {
  it("exposes the FRN login id + mobile password once approved", () => {
    const credentials = adminFranchiseService.buildCredentials({
      franchiseId: "FRN000001",
      mobile: "9876543210",
      panNumber: "ABCDE1234F",
      franchiseStatus: "Approved",
    });

    expect(credentials.loginId).toBe("FRN000001");
    expect(credentials.password).toBe("9876543210");
    expect(credentials.passwordIsMobile).toBe(true);
  });

  it("returns null until an FRN has been minted", () => {
    // Pending / Rejected applications have no franchiseId yet.
    expect(adminFranchiseService.buildCredentials({ mobile: "9876543210" })).toBeNull();
    expect(adminFranchiseService.buildCredentials(null)).toBeNull();
  });
});

describe("buildLoanDocument franchise linkage", () => {
  it("stamps franchise + applicationNo when supplied by the caller", () => {
    const doc = buildLoanDocument(
      "personal",
      { loanAmount: 500000, loanTenure: 3, fullName: "Rahul", mobile: "9876543210" },
      "customer1",
      { franchise: "franchise1", franchiseCode: "FRN000125", applicationNo: "LOAN000042" }
    );

    expect(doc.user).toBe("customer1");
    expect(doc.franchise).toBe("franchise1");
    expect(doc.franchiseCode).toBe("FRN000125");
    expect(doc.applicationNo).toBe("LOAN000042");
  });

  it("leaves the channel null for a direct customer application", () => {
    const doc = buildLoanDocument("personal", { loanAmount: 1, loanTenure: 1 }, "customer1");
    expect(doc.franchise).toBeUndefined();
    expect(doc.applicationNo).toBeUndefined();
  });
});
