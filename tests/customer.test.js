const { buildProductApplyValidator } = require("../src/modules/loans/shared/productApplyValidator");
const { franchiseLoanApplyValidator } = require("../src/modules/franchise/franchise.validator");
const customerService = require("../src/modules/customer/customer.service");
const customerController = require("../src/modules/customer/customer.controller");
const { describeLoanStatus, MODELS } = require("../src/modules/loans/shared/loanStatus");
const { assertNoExistingDirectApplication } = require("../src/modules/loans/shared/loan.service");
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

describe("customerService.getCustomerProductApplication", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the selected product's saved application", async () => {
    const findOne = jest.spyOn(MODELS.personal, "findOne").mockResolvedValue({
      toObject: () => ({
        _id: "application-id",
        user: "customer-id",
        loanType: "Personal Loan",
        loanAmount: 500000,
        loanTenure: 3,
        employmentType: "Salaried",
        fullName: "Rahul Sharma",
        mobile: "9876543210",
        status: "Submitted",
      }),
    });

    await expect(customerService.getCustomerProductApplication("customer-id", "personal")).resolves.toMatchObject({
      _id: "application-id",
      loanType: "Personal Loan",
      loanAmount: 500000,
      sections: {
        loanRequirements: { loanAmount: 500000, loanTenure: 3 },
        personalDetails: { fullName: "Rahul Sharma", mobile: "9876543210" },
      },
    });
    expect(findOne).toHaveBeenCalledWith({ user: "customer-id", franchise: null });
  });

  it("returns null when no application exists for the selected product", async () => {
    const findOne = jest.spyOn(MODELS.business, "findOne").mockResolvedValue(null);

    await expect(customerService.getCustomerProductApplication("customer-id", "business")).resolves.toBeNull();
    expect(findOne).toHaveBeenCalledWith({ user: "customer-id", franchise: null });
  });

  it("blocks a second direct application for the same product with HTTP 409", async () => {
    jest.spyOn(MODELS.personal, "exists").mockResolvedValue({ _id: "application-id" });

    await expect(assertNoExistingDirectApplication(MODELS.personal, "customer-id")).rejects.toMatchObject({
      statusCode: 409,
      message: "You have already applied for this loan product.",
    });
  });
});

describe("customerController.loanApplyForm", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns only the selected product's submitted data and minimal metadata", async () => {
    const savedApplication = {
      loanType: "Personal Loan",
      applicationNo: "LOAN000013",
      loanAmount: 500000,
      sections: { loanRequirements: { loanAmount: 500000 } },
    };
    jest.spyOn(customerService, "getLoanApplyForm").mockReturnValue({
      product: "personal",
      loanType: "Personal Loan",
      route: "/api/personal-loan",
      sections: { loanBasics: ["loanAmount"] },
      submitTo: "POST /api/customer/loan-apply",
    });
    jest
      .spyOn(customerService, "getCustomerProductApplication")
      .mockResolvedValue(savedApplication);

    const response = {
      json: jest.fn(),
    };
    const next = jest.fn();

    await customerController.loanApplyForm(
      { query: { product: "personal" }, user: { id: "customer-id" } },
      response,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      product: "personal",
      loanType: "Personal Loan",
      data: savedApplication,
    });
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
