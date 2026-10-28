const { buildProductApplyValidator } = require("../src/modules/loans/shared/productApplyValidator");
const { franchiseLoanApplyValidator } = require("../src/modules/franchise/franchise.validator");
const customerService = require("../src/modules/customer/customer.service");
const customerController = require("../src/modules/customer/customer.controller");
const { describeLoanStatus, MODELS } = require("../src/modules/loans/shared/loanStatus");
const {
  assertNoRecentApplication,
  compactLoanResponse,
  sanitizeLoanResponse,
} = require("../src/modules/loans/shared/loan.service");
const normalizeApplyPayload = require("../src/middleware/normalizeApplyPayload.middleware");
const verifyEntryDetails = require("../src/middleware/entryDetails.middleware");
const requireEntryProduct = require("../src/middleware/entryProduct.middleware");
const { findEntryProductMismatch } = require("../src/modules/auth/entryProduct");
const { USER_ROLE } = require("../src/constants/roles");
const personalLoanController = require("../src/modules/loans/personal-loan/personalLoan.controller");
const { findEntryDetailMismatch } = require("../src/modules/auth/entryDetails");
const User = require("../src/modules/auth/user.model");
const CustomerLoanDraft = require("../src/modules/customer/customerLoanDraft.model");
const { cancelCustomerLoanDraftValidator } = require("../src/modules/customer/customer.validator");

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

describe("customer loan draft cancellation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("cancels only the draft owned by the authenticated customer", async () => {
    const deleteOne = jest.spyOn(CustomerLoanDraft, "deleteOne").mockResolvedValue({ deletedCount: 1 });
    const result = await customerService.cancelCustomerLoanDraft(
      "customer-id",
      "8f87a217-4568-4d7c-8b2d-7a1523bbdf19"
    );

    expect(deleteOne).toHaveBeenCalledWith({
      user: "customer-id",
      draftId: "8f87a217-4568-4d7c-8b2d-7a1523bbdf19",
      expiresAt: { $gt: expect.any(Date) },
    });
    expect(result).toEqual({
      draftId: "8f87a217-4568-4d7c-8b2d-7a1523bbdf19",
      cancelled: true,
    });
  });

  it("returns 404 when the requested draft is missing or already expired", async () => {
    jest.spyOn(CustomerLoanDraft, "deleteOne").mockResolvedValue({ deletedCount: 0 });

    await expect(
      customerService.cancelCustomerLoanDraft("customer-id", "8f87a217-4568-4d7c-8b2d-7a1523bbdf19")
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("requires a UUID draftId to cancel a draft", async () => {
    const result = await runPipeline(cancelCustomerLoanDraftValidator, { draftId: "not-a-uuid" });
    expect(result.next).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe("customer loan draft retrieval", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the active draft and its ID so the customer can resume or cancel it", async () => {
    const draft = {
      draftId: "8f87a217-4568-4d7c-8b2d-7a1523bbdf19",
      product: "project",
      payload: { product: "project", loanAmount: 2500000 },
      createdAt: new Date("2026-10-23T10:00:00.000Z"),
      expiresAt: new Date("2026-10-24T10:00:00.000Z"),
      updatedAt: new Date("2026-10-23T10:00:00.000Z"),
    };
    const findOne = jest.spyOn(CustomerLoanDraft, "findOne").mockResolvedValue(draft);

    const result = await customerService.getCustomerLoanDraft("customer-id");

    expect(findOne).toHaveBeenCalledWith({
      user: "customer-id",
      expiresAt: { $gt: expect.any(Date) },
    });
    expect(result).toEqual({
      hasPendingDraft: true,
      nextStep: "credit-score",
      draft: {
        draftId: draft.draftId,
        product: "project",
        data: draft.payload,
        createdAt: draft.createdAt,
        expiresAt: draft.expiresAt,
        updatedAt: draft.updatedAt,
      },
    });
  });

  it("indicates when there is no active draft", async () => {
    jest.spyOn(CustomerLoanDraft, "findOne").mockResolvedValue(null);

    await expect(customerService.getCustomerLoanDraft("customer-id")).resolves.toEqual({
      hasPendingDraft: false,
      nextStep: "loan-apply",
      draft: null,
    });
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
    const existingApplication = {
      _id: "application-id",
      createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
    };
    const query = {
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(existingApplication),
    };
    const findOne = jest.spyOn(MODELS.personal, "findOne").mockReturnValue(query);

    const error = await assertNoRecentApplication(MODELS.personal, "customer-id").catch(
      (caught) => caught
    );
    expect(error.statusCode).toBe(409);
    expect(error.message).toContain("Please wait");
    expect(error.retryAfter).toEqual(
      expect.objectContaining({
        days: 2,
        availableAt: expect.any(String),
      })
    );
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "customer-id",
        createdAt: expect.objectContaining({ $gt: expect.any(Date) }),
      })
    );
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(query.select).toHaveBeenCalledWith({ createdAt: 1 });
  });
});

describe("customerController.loanApplyForm", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns a compact application status without duplicate form data", async () => {
    jest.spyOn(customerService, "getLoanApplyScreen").mockResolvedValue({
      product: "personal",
      alreadyApplied: false,
      canApply: true,
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
      alreadyApplied: false,
      canApply: true,
      data: null,
    });
    const payload = response.json.mock.calls[0][0];
    ["loanType", "employmentTypes", "employmentType", "fields", "prefill", "formValues", "applicationNo"].forEach((key) => {
      expect(payload).not.toHaveProperty(key);
    });
    expect(customerService.getLoanApplyScreen).toHaveBeenCalledWith("customer-id", {
      product: "personal",
    });
  });
});

describe("customerService.getLoanApplyScreen", () => {
  beforeEach(() => {
    jest.spyOn(CustomerLoanDraft, "findOne").mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the saved application once without sections or empty values", async () => {
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
        monthlySalary: "",
        existingBanks: [],
        franchise: null,
        status: "Submitted",
        sections: { loanRequirements: { loanAmount: 500000, loanTenure: 3 } },
      }),
    });

    const screen = await customerService.getLoanApplyScreen("customer-id", { product: "personal" });

    expect(screen).toMatchObject({
      product: "personal",
      alreadyApplied: true,
      canApply: false,
      data: {
        applicationNo: "LOAN000013",
        loanAmount: 500000,
        loanTenure: 3,
        employmentType: "Salaried",
        fullName: "Rahul Sharma",
        mobile: "9876543210",
      },
    });
    ["loanType", "employmentTypes", "employmentType", "fields", "prefill", "formValues", "applicationNo"].forEach((key) => {
      expect(screen).not.toHaveProperty(key);
    });
    expect(screen.data).not.toHaveProperty("sections");
    expect(screen.data).not.toHaveProperty("_id");
    expect(screen.data).not.toHaveProperty("user");
    expect(screen.data).not.toHaveProperty("monthlySalary");
    expect(screen.data).not.toHaveProperty("existingBanks");
    expect(screen.data).not.toHaveProperty("franchise");
  });

  it("returns existing business details once without an additional prefill copy", async () => {
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
        sections: { personalDetails: { fullName: "Naya Customer Business" } },
      }),
    });

    const screen = await customerService.getLoanApplyScreen("customer-id", { product: "business" });

    expect(screen.data).toMatchObject({
      fullName: "Naya Customer Business",
      mobile: "9876543220",
      state: "Maharashtra",
      city: "Mumbai",
      pincode: "400001",
    });
    expect(screen.data).not.toHaveProperty("sections");
    expect(screen).not.toHaveProperty("prefill");
  });

  it("preserves populated business values in the compact application", async () => {
    jest.spyOn(MODELS.business, "findOne").mockResolvedValue({
      toObject: () => ({
        applicationNo: "LOAN000050",
        loanAmount: 2500000,
        loanTenure: 5,
        employmentType: "Self Employed - Business",
        businessEstablishedDate: new Date("2015-06-01T00:00:00.000Z"),
        transactionBankName: { displayName: "HDFC Bank", banks: ["HDFC Bank"] },
        existingBanks: ["HDFC Bank", "ICICI Bank"],
        existingLoanTypes: ["Home Loan", "Car Loan"],
        fullName: "Testing Customer",
        mobile: "9876543221",
        email: "testing@example.com",
        dob: new Date("1988-11-23T00:00:00.000Z"),
      }),
    });

    const screen = await customerService.getLoanApplyScreen("customer-id", {
      product: "business",
    });

    expect(screen.data).toMatchObject({
      loanAmount: 2500000,
      loanTenure: 5,
      employmentType: "Self Employed - Business",
      businessEstablishedDate: new Date("2015-06-01T00:00:00.000Z"),
      transactionBankName: { displayName: "HDFC Bank", banks: ["HDFC Bank"] },
      existingBanks: ["HDFC Bank", "ICICI Bank"],
      existingLoanTypes: ["Home Loan", "Car Loan"],
      fullName: "Testing Customer",
    });
  });

  it("returns no data + canApply true when nothing is applied yet", async () => {
    jest.spyOn(MODELS.business, "findOne").mockResolvedValue(null);

    const screen = await customerService.getLoanApplyScreen("customer-id", { product: "business" });

    expect(screen).toMatchObject({
      product: "business",
      alreadyApplied: false,
      canApply: true,
      data: null,
    });
    ["loanType", "employmentTypes", "employmentType", "fields", "prefill", "formValues", "applicationNo"].forEach((key) => {
      expect(screen).not.toHaveProperty(key);
    });
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

/*
==========================================
Entry product scope — personal ka token home loan apply na kar sake.

Rule `modules/auth/entryProduct.js` me hai; dono apply doors isse chalate hain
(`middleware/entryProduct.middleware.js` route chain ke andar).
==========================================
*/
describe("entry product scope (token ka product vs apply ka product)", () => {
  const token = (product, role = USER_ROLE.CUSTOMER) => ({ id: "customer-id", role, product });

  /** Route jaisa: token claims + body ke saath ek chain chalao. */
  const runDoor = (chain, { body, user }) =>
    new Promise((resolve) => {
      const req = { body, user };
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
        chain[index++](req, res, step);
      };
      step();
    });

  it("allows the product the token was minted for", () => {
    expect(findEntryProductMismatch("personal", "personal")).toBeNull();
    expect(findEntryProductMismatch("personal", " personal ")).toBeNull();
  });

  it("names both products in the message when the product was switched", () => {
    const mismatch = findEntryProductMismatch("personal", "home");

    expect(mismatch.entryProduct).toBe("personal");
    expect(mismatch.requestedProduct).toBe("home");
    expect(mismatch.message).toContain("Personal Loan");
    expect(mismatch.message).toContain("Home Loan");
  });

  it("blocks a token that carries no product at all (pre-change token)", () => {
    const mismatch = findEntryProductMismatch("", "home");

    expect(mismatch.entryProduct).toBe("");
    expect(mismatch.message).toContain("not verified for Home Loan");
  });

  it("leaves an unknown product to the product validator", () => {
    expect(findEntryProductMismatch("personal", "crypto-loan")).toBeNull();
  });

  it("rejects a switched product with 403 on a per-product door", async () => {
    const result = await runDoor([requireEntryProduct("home")], {
      body: {},
      user: token("personal"),
    });

    expect(result.next).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.payload).toMatchObject({
      success: false,
      entryProduct: "personal",
      requestedProduct: "home",
    });
  });

  it("lets the matching product through on a per-product door", async () => {
    const result = await runDoor([requireEntryProduct("home")], { body: {}, user: token("home") });

    expect(result.next).toBe(true);
  });

  it("skips the check for franchise tokens (their product comes from the URL)", async () => {
    const result = await runDoor([requireEntryProduct("home")], {
      body: {},
      user: token("", USER_ROLE.FRANCHISE),
    });

    expect(result.next).toBe(true);
  });

  it("blocks the unified door before any field validation runs", async () => {
    const result = await runDoor([normalizeApplyPayload, buildProductApplyValidator()], {
      body: { product: "home" },
      user: token("personal"),
    });

    expect(result.statusCode).toBe(403);
    expect(result.payload.message).toContain("Home Loan");
  });

  it("still accepts the unified door when the token's product matches the body", async () => {
    const result = await runDoor([normalizeApplyPayload, buildProductApplyValidator()], {
      body: validPersonal,
      user: token("personal"),
    });

    expect(result.next).toBe(true);
  });

  it("runs the rule inside the per-product validator chain too", async () => {
    const { applyValidator } = require("../src/modules/loans/personal-loan/personalLoan.validator");

    const switched = await runDoor(applyValidator, { body: validPersonal, user: token("home") });
    expect(switched.statusCode).toBe(403);

    const matching = await runDoor(applyValidator, { body: validPersonal, user: token("personal") });
    expect(matching.next).toBe(true);
  });
});

/*
==========================================
Applicant ke response me sirf applicant ka data.

Do darwaze the: khaali `transactionBankName: { banks: [] }` (jo customer ne chuna
hi nahi tha) response aur sections me aa jaata tha, aur `franchise` /
`franchiseCode` / `franchiseCustomer` jaise bookkeeping fields bhi direct customer
ke response me dikh rahe the (`_id` / `user` / `__v` ke saath).
==========================================
*/
describe("applicant-facing response (compactLoanResponse + empty bank)", () => {
  it("drops an untouched transaction bank from the response and the sections", () => {
    const response = sanitizeLoanResponse("business", {
      employmentType: "Self Employed - Professional",
      profession: "Chartered Accountant",
      currentYearTurnover: 23456,
      businessState: "Delhi",
      transactionBankName: [],
    });

    expect(response.transactionBankName).toBeUndefined();
    expect(response.sections.incomeDetails.transactionBankName).toBeUndefined();
    expect(response.sections.incomeDetails.profession).toBe("Chartered Accountant");
  });

  it("keeps the transaction bank when one was actually selected", () => {
    const response = sanitizeLoanResponse("business", {
      employmentType: "Self Employed - Professional",
      transactionBankName: { displayName: "HDFC Bank", banks: ["HDFC Bank"] },
    });

    expect(response.transactionBankName).toEqual({ displayName: "HDFC Bank", banks: ["HDFC Bank"] });
  });

  it("keeps only what the applicant filled in", () => {
    const dob = new Date("2002-10-11T00:00:00.000Z");

    const compact = compactLoanResponse({
      _id: "doc-id",
      user: "user-id",
      __v: 0,
      applicationNo: "LOAN000056",
      status: "Submitted",
      franchise: null,
      franchiseCode: null,
      franchiseCustomer: null,
      existingBanks: [],
      otherBankList: [],
      panNumber: "",
      transactionBankName: { banks: [] },
      dob,
      sections: { loanRequirements: { loanAmount: 1234567 } },
    });

    expect(compact).toEqual({ applicationNo: "LOAN000056", status: "Submitted", dob });
    ["_id", "user", "__v", "franchise", "franchiseCode", "franchiseCustomer", "sections"].forEach(
      (key) => expect(compact).not.toHaveProperty(key)
    );
  });

  it("keeps the franchise bookkeeping when a franchise actually filed the loan", () => {
    const compact = compactLoanResponse({
      applicationNo: "LOAN000001",
      franchise: "franchise-id",
      franchiseCode: "FRN000001",
      franchiseCustomer: "customer-id",
    });

    expect(compact).toMatchObject({
      franchise: "franchise-id",
      franchiseCode: "FRN000001",
      franchiseCustomer: "customer-id",
    });
  });

  it("keeps the sections snapshot only when asked (submit response)", () => {
    const withSections = compactLoanResponse(
      { applicationNo: "LOAN000001", sections: { loanRequirements: { loanAmount: 1 } } },
      { keepSections: true }
    );
    const withoutSections = compactLoanResponse({
      applicationNo: "LOAN000001",
      sections: { loanRequirements: { loanAmount: 1 } },
    });

    expect(withSections.sections).toEqual({ loanRequirements: { loanAmount: 1 } });
    expect(withoutSections).not.toHaveProperty("sections");
  });
});
