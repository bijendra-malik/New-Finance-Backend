const { buildProductApplyValidator } = require("../src/modules/loans/shared/productApplyValidator");
const { franchiseLoanApplyValidator } = require("../src/modules/franchise/franchise.validator");
const customerService = require("../src/modules/customer/customer.service");
const customerController = require("../src/modules/customer/customer.controller");
const { describeLoanStatus, MODELS } = require("../src/modules/loans/shared/loanStatus");
const { assertNoExistingDirectApplication } = require("../src/modules/loans/shared/loan.service");
const normalizeApplyPayload = require("../src/middleware/normalizeApplyPayload.middleware");
const verifyEntryDetails = require("../src/middleware/entryDetails.middleware");
const personalLoanController = require("../src/modules/loans/personal-loan/personalLoan.controller");
const { findEntryDetailMismatch } = require("../src/modules/auth/entryDetails");
const User = require("../src/modules/auth/user.model");

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

  it("returns the form screen — fields, entry prefill and the already-applied flag", async () => {
    jest.spyOn(customerService, "getLoanApplyScreen").mockResolvedValue({
      product: "personal",
      loanType: "Personal Loan",
      employmentTypes: ["Salaried"],
      employmentType: "Salaried",
      fields: { loanRequirements: ["loanAmount", "loanTenure"] },
      prefill: { fullName: "Rahul Sharma", mobile: "9876543210" },
      alreadyApplied: false,
      canApply: true,
      applicationNo: null,
      data: null,
    });

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
      employmentTypes: ["Salaried"],
      employmentType: "Salaried",
      fields: { loanRequirements: ["loanAmount", "loanTenure"] },
      prefill: { fullName: "Rahul Sharma", mobile: "9876543210" },
      alreadyApplied: false,
      canApply: true,
      applicationNo: null,
      data: null,
    });
    expect(customerService.getLoanApplyScreen).toHaveBeenCalledWith("customer-id", {
      product: "personal",
      employmentType: undefined,
    });
  });
});

describe("customerService.getLoanApplyScreen", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockAccount = (account = {}) =>
    jest.spyOn(User, "findById").mockReturnValue({ select: () => Promise.resolve(account) });

  it("returns the saved application + that employment type's fields", async () => {
    jest.spyOn(MODELS.personal, "findOne").mockResolvedValue({
      toObject: () => ({
        _id: "application-id",
        user: "customer-id",
        applicationNo: "LOAN000013",
        loanType: "Personal Loan",
        loanAmount: 500000,
        loanTenure: 3,
        employmentType: "Salaried",
        fullName: "Rahul Sharma",
        mobile: "9876543210",
        status: "Submitted",
      }),
    });
    mockAccount({
      name: "Rahul Sharma",
      mobile: "9876543210",
      email: "rahul@example.com",
      dob: new Date("1995-05-15T00:00:00.000Z"),
      panNumber: "ABCDE1234F",
    });

    const screen = await customerService.getLoanApplyScreen("customer-id", { product: "personal" });

    expect(screen).toMatchObject({
      product: "personal",
      loanType: "Personal Loan",
      employmentTypes: ["Salaried"],
      employmentType: "Salaried",
      alreadyApplied: true,
      canApply: false,
      applicationNo: "LOAN000013",
      prefill: {
        fullName: "Rahul Sharma",
        mobile: "9876543210",
        dob: "1995-05-15",
        panNumber: "ABCDE1234F",
      },
    });
    expect(screen.fields.loanRequirements).toEqual(["loanAmount", "loanTenure"]);
    expect(screen.fields.incomeDetails).toContain("monthlySalary");
    expect(screen.data.sections.loanRequirements).toEqual({ loanAmount: 500000, loanTenure: 3 });
  });

  it("fills the entry form's empty address fields from the submitted application", async () => {
    jest.spyOn(MODELS.business, "findOne").mockResolvedValue({
      toObject: () => ({
        _id: "application-id",
        user: "customer-id",
        applicationNo: "LOAN000047",
        loanType: "Business Loan",
        employmentType: "Self Employed - Business",
        fullName: "Naya Customer Business",
        mobile: "9876543220",
        email: "naya.customer.business@example.com",
        dob: "1988-11-11T00:00:00.000Z",
        panNumber: "NEWCU1234B",
        state: "Maharashtra",
        city: "Mumbai",
        pincode: "400001",
        status: "Submitted",
      }),
    });
    // Entry form me state / city / pincode nahi puchhe jaate — account par khaali hain.
    mockAccount({
      name: "Naya Customer Business",
      mobile: "9876543220",
      email: "naya.customer.business@example.com",
      dob: new Date("1988-11-11T00:00:00.000Z"),
      panNumber: "NEWCU1234B",
      continent: "Asia",
      country: "India",
      state: "",
      city: "",
      pincode: "",
    });

    const screen = await customerService.getLoanApplyScreen("customer-id", { product: "business" });

    expect(screen.prefill).toEqual({
      fullName: "Naya Customer Business",
      mobile: "9876543220",
      email: "naya.customer.business@example.com",
      dob: "1988-11-11",
      panNumber: "NEWCU1234B",
      continent: "Asia",
      country: "India",
      state: "Maharashtra",
      city: "Mumbai",
      pincode: "400001",
    });
  });

  it("keeps the account's own value when the application has one as well", async () => {
    jest.spyOn(MODELS.business, "findOne").mockResolvedValue({
      toObject: () => ({
        _id: "application-id",
        user: "customer-id",
        applicationNo: "LOAN000048",
        loanType: "Business Loan",
        employmentType: "Self Employed - Business",
        fullName: "Application Name",
        mobile: "9000000000",
        state: "Karnataka",
        city: "Bengaluru",
        pincode: "560001",
        status: "Submitted",
      }),
    });
    mockAccount({
      name: "Account Name",
      mobile: "9876543210",
      state: "Maharashtra",
      city: "Pune",
      pincode: "411001",
    });

    const screen = await customerService.getLoanApplyScreen("customer-id", { product: "business" });

    expect(screen.prefill).toMatchObject({
      fullName: "Account Name",
      mobile: "9876543210",
      state: "Maharashtra",
      city: "Pune",
      pincode: "411001",
    });
  });

  it("returns no data + canApply true when nothing is applied yet", async () => {
    jest.spyOn(MODELS.business, "findOne").mockResolvedValue(null);
    mockAccount({ name: "Rahul Sharma", mobile: "9876543210" });

    const screen = await customerService.getLoanApplyScreen("customer-id", {
      product: "business",
      employmentType: "Self Employed - Business",
    });

    expect(screen).toMatchObject({
      product: "business",
      employmentType: "Self Employed - Business",
      alreadyApplied: false,
      canApply: true,
      data: null,
    });
    expect(screen.fields.incomeDetails).toContain("businessName");
  });
});

describe("verifyEntryDetails (entry details vs loan form details)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const account = {
    name: "Rahul Sharma",
    mobile: "9876543210",
    email: "rahul@example.com",
    dob: new Date("1995-05-15T00:00:00.000Z"),
    panNumber: "ABCDE1234F",
  };

  /** Runs the middleware like the real route does. */
  const runMiddleware = (body) =>
    new Promise((resolve) => {
      const req = { body, user: { id: "customer-id" } };
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

      verifyEntryDetails(req, res, (error) => resolve({ next: true, error, req }));
    });

  it("passes when the form carries the same verified details", async () => {
    jest.spyOn(User, "findById").mockResolvedValue(account);

    const result = await runMiddleware({
      fullName: "rahul sharma",
      mobile: "9876543210",
      email: "Rahul@Example.com",
      dob: "1995-05-15",
      panNumber: "abcde1234f",
    });

    expect(result.next).toBe(true);
  });

  it("fills a field the form did not send from the verified account", async () => {
    jest.spyOn(User, "findById").mockResolvedValue(account);

    const result = await runMiddleware({ product: "personal", loanAmount: 500000 });

    expect(result.next).toBe(true);
    expect(result.req.body).toMatchObject({
      fullName: "Rahul Sharma",
      mobile: "9876543210",
      email: "rahul@example.com",
      panNumber: "ABCDE1234F",
    });
    expect(result.req.body.dob).toEqual(account.dob);
  });

  it("rejects a different mobile number with 400", async () => {
    jest.spyOn(User, "findById").mockResolvedValue(account);

    const result = await runMiddleware({ product: "personal", mobile: "9999999902" });

    expect(result.next).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.payload.success).toBe(false);
    expect(result.payload.message).toContain("Mobile number does not match");
  });

  it("rejects a different PAN and a different date of birth", async () => {
    jest.spyOn(User, "findById").mockResolvedValue(account);

    const pan = await runMiddleware({ product: "personal", panNumber: "ZZZZZ9999Z" });
    expect(pan.statusCode).toBe(400);
    expect(pan.payload.message).toContain("PAN number does not match");

    const dob = await runMiddleware({ product: "personal", dob: "1915-05-22" });
    expect(dob.statusCode).toBe(400);
    expect(dob.payload.message).toContain("Date of birth does not match");
  });
});

describe("findEntryDetailMismatch (shared rule used by both apply doors)", () => {
  const account = {
    name: "Rahul Sharma",
    mobile: "9876543210",
    email: "rahul@example.com",
    dob: new Date("1995-05-15T00:00:00.000Z"),
    panNumber: "ABCDE1234F",
  };

  it("returns null and fills the omitted fields from the verified account", () => {
    const body = { product: "personal", loanAmount: 500000 };

    expect(findEntryDetailMismatch(account, body)).toBeNull();
    expect(body).toMatchObject({
      fullName: "Rahul Sharma",
      mobile: "9876543210",
      email: "rahul@example.com",
      panNumber: "ABCDE1234F",
    });
    expect(body.dob).toEqual(account.dob);
  });

  it("ignores case / spacing and compares the DOB by date, not by string", () => {
    expect(
      findEntryDetailMismatch(account, {
        fullName: "  rahul   sharma ",
        mobile: " 9876543210 ",
        email: "RAHUL@example.com",
        panNumber: "abcde1234f",
        dob: "1995-05-15T00:00:00.000Z",
      })
    ).toBeNull();
  });

  it("reports the mismatched field with its verified value", () => {
    expect(findEntryDetailMismatch(account, { mobile: "9999999902" })).toMatchObject({
      field: "mobile",
      message: expect.stringContaining("Please use the same mobile number (9876543210)"),
    });
    expect(findEntryDetailMismatch(account, { fullName: "Koi Aur" }).field).toBe("fullName");
    expect(findEntryDetailMismatch(account, { email: "other@example.com" }).field).toBe("email");
    expect(findEntryDetailMismatch(account, { panNumber: "ZZZZZ9999Z" }).field).toBe("panNumber");
    expect(findEntryDetailMismatch(account, { dob: "1915-05-22" }).field).toBe("dob");
  });

  it("skips the check when the account itself has no verified value", () => {
    expect(findEntryDetailMismatch({ mobile: "9876543210" }, { panNumber: "ZZZZZ9999Z" })).toBeNull();
  });
});

describe("per-product door (POST /api/personal-loan/apply) enforces the same rule", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects a mismatched mobile with 400 before touching the database", async () => {
    jest.spyOn(User, "findById").mockResolvedValue({
      name: "Rahul",
      mobile: "9876543210",
      email: "rahul@example.com",
      dob: new Date("1995-05-15T00:00:00.000Z"),
      panNumber: "ABCDE1234F",
    });
    const exists = jest.spyOn(MODELS.personal, "exists");
    const create = jest.spyOn(MODELS.personal, "create");

    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    const next = jest.fn();

    await personalLoanController.apply(
      { body: { ...validPersonal, mobile: "9999999902" }, user: { id: "customer-id", role: "Customer" } },
      res,
      next
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("Mobile number does not match");
    expect(exists).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
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
