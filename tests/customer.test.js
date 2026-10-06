const { buildProductApplyValidator } = require("../src/modules/loans/shared/productApplyValidator");
const { applyRegisterValidator } = require("../src/modules/customer/customer.validator");
const { franchiseLoanApplyValidator } = require("../src/modules/franchise/franchise.validator");
const customerService = require("../src/modules/customer/customer.service");
const customerController = require("../src/modules/customer/customer.controller");
const User = require("../src/modules/auth/user.model");
const { describeLoanStatus } = require("../src/modules/loans/shared/loanStatus");
const normalizeApplyPayload = require("../src/middleware/normalizeApplyPayload.middleware");

/** Runs a chain of middlewares (like the real route) and reports the outcome. */
const runPipeline = (chain, body) =>
  new Promise((resolve) => {
    const req = { body };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ next: false, statusCode: this.statusCode, payload, req });
      },
    };

    let index = 0;
    const step = (error) => {
      if (error) return resolve({ next: false, error });
      if (index >= chain.length) return resolve({ next: true, req });
      const middleware = chain[index++];
      middleware(req, res, step);
    };
    step();
  });

const validPersonal = {
  product: "personal",
  loanAmount: 500000,
  loanTenure: 3,
  employmentType: "Salaried",
  companyName: "ABC Corp",
  companyType: "Private Limited",
  monthlySalary: 50000,
  salaryReceivedAs: "Bank Transfer",
  salaryBankName: "HDFC",
  fullName: "Rahul",
  mobile: "9876543210",
  email: "rahul@example.com",
  dob: "1995-05-15",
  panNumber: "ABCDE1234F",
};

describe("productApplyValidator (unified customer + franchise entry points)", () => {
  it("customer validator runs the product's rules and passes a valid payload", async () => {
    const result = await runPipeline([normalizeApplyPayload, buildProductApplyValidator()], validPersonal);
    expect(result.next).toBe(true);
  });

  it("customer validator rejects a payload that fails product rules", async () => {
    const result = await runPipeline([normalizeApplyPayload, buildProductApplyValidator()], {
      product: "personal",
      loanAmount: 500000,
    });
    expect(result.next).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it("customer validator rejects an unknown product", async () => {
    const result = await runPipeline([normalizeApplyPayload, buildProductApplyValidator()], { product: "unknown" });
    expect(result.next).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.payload.success).toBe(false);
  });

  it("franchise validator uses the same dispatcher", async () => {
    const result = await runPipeline([normalizeApplyPayload, franchiseLoanApplyValidator], validPersonal);
    expect(result.next).toBe(true);
  });

  it("handles a data wrapper exactly like the route (normalize + dispatch)", async () => {
    const result = await runPipeline([normalizeApplyPayload, buildProductApplyValidator()], {
      data: validPersonal,
    });
    expect(result.next).toBe(true);
  });
});

describe("customerService.resolveProduct", () => {
  it("returns a known product key", () => {
    expect(customerService.resolveProduct({ product: "personal" })).toBe("personal");
    expect(customerService.resolveProduct({ product: "home" })).toBe("home");
  });

  it("throws a 400 for an unknown product", () => {
    let error;
    try {
      customerService.resolveProduct({ product: "nope" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(400);
  });
});

describe("loanStatus.describeLoanStatus", () => {
  it("maps raw statuses to friendly stages", () => {
    expect(describeLoanStatus("Submitted")).toMatchObject({ stageKey: "submitted", step: 1 });
    expect(describeLoanStatus("Pending")).toMatchObject({ stage: "Under Review", stageKey: "under_review", step: 2 });
    expect(describeLoanStatus("Approved")).toMatchObject({ stageKey: "approved", step: 3 });
    expect(describeLoanStatus("Rejected")).toMatchObject({ stageKey: "rejected", step: 3 });
  });

  it("falls back to Submitted for unknown/legacy values", () => {
    expect(describeLoanStatus("SomethingElse").stageKey).toBe("submitted");
  });
});

describe("customerService.buildStatusView", () => {
  const base = {
    _id: "x",
    applicationNo: "LOAN000001",
    loanType: "Personal Loan",
    loanAmount: 500000,
    loanTenure: 3,
    employmentType: "Salaried",
    adminNote: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  };

  it("builds an under-review view with a 2-step timeline", () => {
    const view = customerService.buildStatusView("personal", { ...base, status: "Pending" });
    expect(view.status).toBe("Pending");
    expect(view.stageKey).toBe("under_review");
    expect(view.timeline.map((t) => t.step)).toEqual(["Application Submitted", "Under Review"]);
  });

  it("builds an approved view with decisionAt", () => {
    const view = customerService.buildStatusView("personal", {
      ...base,
      status: "Approved",
      approvedAt: "2026-10-03T00:00:00.000Z",
    });
    expect(view.stageKey).toBe("approved");
    expect(view.decisionAt).toBe("2026-10-03T00:00:00.000Z");
    expect(view.timeline[1].step).toBe("Approved");
  });

  it("defaults to Submitted when status is missing", () => {
    const view = customerService.buildStatusView("personal", { ...base });
    expect(view.status).toBe("Submitted");
    expect(view.timeline).toHaveLength(1);
  });
});

describe("customerService.validateApplyRegistration (step 1: dob + PAN)", () => {
  const valid = { product: "personal", dob: "1995-05-15", panNumber: "ABCDE1234F" };

  it("accepts a product + DOB + PAN and returns the applicant basics", () => {
    const result = customerService.validateApplyRegistration(valid);
    expect(result.product).toBe("personal");
    expect(result.loanType).toBe("Personal Loan");
    expect(result.applicant.panNumber).toBe("ABCDE1234F");
    expect(result.applicant.dob).toBe("1995-05-15");
    expect(result.age).toBeGreaterThan(18);
  });

  it("normalises a lowercase PAN to uppercase", () => {
    const result = customerService.validateApplyRegistration({ ...valid, panNumber: "abcde1234f" });
    expect(result.applicant.panNumber).toBe("ABCDE1234F");
  });

  it("uses the name supplied from the registered customer account", () => {
    const result = customerService.validateApplyRegistration(
      { ...valid, fullName: "Name from request" },
      "Registered Customer"
    );
    expect(result.applicant.name).toBe("Registered Customer");
  });

  it("rejects an unknown product", () => {
    expect(() => customerService.validateApplyRegistration({ ...valid, product: "nope" }))
      .toThrowError(/valid loan product/i);
  });

  it("rejects a malformed PAN", () => {
    expect(() => customerService.validateApplyRegistration({ ...valid, panNumber: "BADPAN" }))
      .toThrowError(/PAN/i);
  });

  it("rejects an applicant under 18", () => {
    expect(() => customerService.validateApplyRegistration({ ...valid, dob: "2015-01-01" }))
      .toThrowError(/18 years/);
  });

  it("rejects an invalid date of birth", () => {
    expect(() => customerService.validateApplyRegistration({ ...valid, dob: "not-a-date" }))
      .toThrowError(/date of birth/i);
  });
});

describe("customerController.applyRegister", () => {
  it("loads the authenticated customer's registered name for the response", async () => {
    const findById = jest.spyOn(User, "findById").mockResolvedValue({ name: "Registered Customer" });
    const response = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };
    const next = jest.fn();

    await customerController.applyRegister(
      {
        user: { id: "customer-id" },
        body: { product: "personal", dob: "1995-05-15", panNumber: "ABCDE1234F" },
      },
      response,
      next
    );

    expect(findById).toHaveBeenCalledWith("customer-id");
    expect(response.payload.applicant.name).toBe("Registered Customer");
    expect(next).not.toHaveBeenCalled();
    findById.mockRestore();
  });
});

describe("applyRegisterValidator", () => {
  it("passes with product, PAN and DOB", async () => {
    const result = await runPipeline(applyRegisterValidator, {
      product: "personal", panNumber: "ABCDE1234F", dob: "1995-05-15",
    });
    expect(result.next).toBe(true);
  });

  it("rejects a missing PAN", async () => {
    const result = await runPipeline(applyRegisterValidator, {
      product: "personal", dob: "1995-05-15",
    });
    expect(result.next).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it("rejects a missing product", async () => {
    const result = await runPipeline(applyRegisterValidator, {
      panNumber: "ABCDE1234F", dob: "1995-05-15",
    });
    expect(result.next).toBe(false);
  });
});
