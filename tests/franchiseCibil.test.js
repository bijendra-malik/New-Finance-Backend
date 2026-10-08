jest.mock("../src/modules/franchise/franchiseCustomer.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../src/modules/franchise/franchise.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
}));
jest.mock("../src/modules/auth/user.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../src/modules/franchise/cibil/providers", () => ({
  PROVIDERS: {},
  resolveProvider: jest.fn(),
}));

const mongoose = require("mongoose");

const FranchiseCustomer = require("../src/modules/franchise/franchiseCustomer.model");
const Franchise = require("../src/modules/franchise/franchise.model");
const User = require("../src/modules/auth/user.model");
const { resolveProvider } = require("../src/modules/franchise/cibil/providers");
const cibilService = require("../src/modules/franchise/cibil/cibil.service");
const customerService = require("../src/modules/franchise/franchiseCustomer.service");
const franchiseService = require("../src/modules/franchise/franchise.service");
const { MODELS } = require("../src/modules/loans/shared/loanModels");
const { USER_ROLE } = require("../src/constants/roles");

const FRANCHISE = { _id: "frn-id", franchiseId: "FRN000001", franchiseStatus: "Approved" };
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
// Service `mongoose.isValidObjectId` check karti hai, isliye real ObjectId ids.
const FC_ID = new mongoose.Types.ObjectId().toString();
const OTHER_ID = new mongoose.Types.ObjectId().toString();

const franchiseCustomerDoc = (overrides = {}) => ({
  _id: FC_ID,
  franchise: "frn-id",
  fullName: "Rahul Sharma",
  mobile: "9876543210",
  email: "rahul@example.com",
  panNumber: "ABCDE1234F",
  dob: new Date("1995-05-15"),
  cibil: { status: "NotChecked" },
  save: jest.fn().mockResolvedValue(undefined),
  toObject() {
    const { save, toObject, ...rest } = this;
    return rest;
  },
  ...overrides,
});

describe("CIBIL lock/unlock policy (pure)", () => {
  it("keeps the loan form locked until a check happens", () => {
    const eligibility = cibilService.buildEligibility({ cibil: { status: "NotChecked" } });

    expect(eligibility.status).toBe("NotChecked");
    expect(eligibility.locked).toBe(true);
    expect(eligibility.canApplyLoan).toBe(false);
    expect(eligibility.reason).toMatch(/CIBIL check is pending/i);
  });

  it("unlocks the form for a good score that is still valid", () => {
    const eligibility = cibilService.buildEligibility({
      cibil: { status: "Checked", score: 800, expiresAt: FUTURE, checkedAt: new Date(), provider: "mock" },
    });

    expect(eligibility.canApplyLoan).toBe(true);
    expect(eligibility.locked).toBe(false);
    expect(eligibility.reason).toBeNull();
    expect(eligibility.band.label).toBe("Excellent");
    expect(eligibility.threshold).toBe(650);
  });

  it("stays locked when the score is below the threshold", () => {
    const eligibility = cibilService.buildEligibility({
      cibil: { status: "Checked", score: 600, expiresAt: FUTURE },
    });

    expect(eligibility.locked).toBe(true);
    expect(eligibility.reason).toMatch(/below the required threshold/i);
    expect(eligibility.score).toBe(600);
    expect(eligibility.band.label).toBe("Poor");
  });

  it("locks again when the report has expired", () => {
    const eligibility = cibilService.buildEligibility({
      cibil: { status: "Checked", score: 810, expiresAt: PAST },
    });

    expect(eligibility.locked).toBe(true);
    expect(eligibility.reason).toMatch(/expired/i);
  });

  it("keeps the form locked after a failed check", () => {
    const eligibility = cibilService.buildEligibility({
      cibil: { status: "Failed", failureReason: "bureau timeout" },
    });

    expect(eligibility.locked).toBe(true);
    expect(eligibility.reason).toMatch(/could not be completed/i);
    expect(eligibility.failureReason).toBe("bureau timeout");
  });
});

describe("franchise customer register (step 1)", () => {
  beforeEach(() => jest.clearAllMocks());

  const payload = {
    fullName: "Rahul Sharma",
    mobile: "9876543210",
    panNumber: "abcde1234f",
    dob: "1995-05-15",
    email: "Rahul@Example.com",
    city: "Pune",
  };

  it("saves the basic details, scoped to the franchise, with the form locked", async () => {
    Franchise.findOne.mockResolvedValue(null);
    FranchiseCustomer.findOne.mockResolvedValue(null);
    FranchiseCustomer.create.mockImplementation(async (doc) => franchiseCustomerDoc(doc));

    const result = await customerService.registerCustomer(FRANCHISE, payload);

    expect(FranchiseCustomer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        franchise: "frn-id",
        franchiseCode: "FRN000001",
        fullName: "Rahul Sharma",
        mobile: "9876543210",
        panNumber: "ABCDE1234F",
        email: "rahul@example.com",
        cibil: { status: "NotChecked" },
      })
    );
    expect(result.loanForm.locked).toBe(true);
    expect(result.loanForm.canApplyLoan).toBe(false);
  });

  it("rejects a duplicate registration by the same franchise with 409", async () => {
    Franchise.findOne.mockResolvedValue(null);
    FranchiseCustomer.findOne.mockResolvedValue({ _id: "existing" });

    await expect(customerService.registerCustomer(FRANCHISE, payload)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(FranchiseCustomer.create).not.toHaveBeenCalled();
  });

  it("rejects the franchise's own mobile and a malformed PAN", async () => {
    Franchise.findOne.mockResolvedValue({ _id: "frn-id", mobile: "9876543210" });

    await expect(customerService.registerCustomer(FRANCHISE, payload)).rejects.toThrow(
      /belongs to a franchise account/i
    );

    Franchise.findOne.mockResolvedValue(null);

    await expect(
      customerService.registerCustomer(FRANCHISE, { ...payload, panNumber: "BADPAN" })
    ).rejects.toThrow(/valid PAN/i);
  });

  it("only serves customers of the calling franchise (cross-franchise = 404)", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(null);

    await expect(customerService.getCustomer(FRANCHISE, OTHER_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(FranchiseCustomer.findOne).toHaveBeenCalledWith({
      _id: OTHER_ID,
      franchise: "frn-id",
    });
  });
});

describe("CIBIL check (step 2)", () => {
  beforeEach(() => jest.clearAllMocks());

  const providerWith = (result) => ({
    name: "test-bureau",
    fetchScore: jest.fn(async () => result),
  });

  it("stores the score and unlocks the loan form for a good score", async () => {
    const customer = franchiseCustomerDoc();
    FranchiseCustomer.findOne.mockResolvedValue(customer);
    resolveProvider.mockReturnValue(providerWith({ success: true, score: 812, bureau: "TEST", referenceId: "REF-1" }));

    const result = await customerService.runCheck(FRANCHISE, FC_ID, { consent: true });

    expect(result.cibil.status).toBe("Checked");
    expect(result.cibil.score).toBe(812);
    expect(result.cibil.referenceId).toBe("REF-1");
    expect(result.cibil.provider).toBe("test-bureau");
    expect(new Date(result.cibil.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(result.loanForm.canApplyLoan).toBe(true);
    expect(result.loanForm.locked).toBe(false);
    expect(customer.cibilConsentAt).toBeInstanceOf(Date);
    expect(customer.save).toHaveBeenCalled();
  });

  it("keeps the form locked when the provider fails", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc());
    resolveProvider.mockReturnValue(providerWith({ success: false, failureReason: "bureau network error" }));

    const result = await customerService.runCheck(FRANCHISE, FC_ID, { consent: true });

    expect(result.cibil.status).toBe("Failed");
    expect(result.cibil.failureReason).toBe("bureau network error");
    expect(result.loanForm.locked).toBe(true);
  });

  it("requires customer consent (service-level guard)", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc());

    await expect(customerService.runCheck(FRANCHISE, FC_ID, {})).rejects.toThrow(/consent/i);
  });

  it("re-locks the form when PAN changes (old report becomes invalid)", async () => {
    const customer = franchiseCustomerDoc({ cibil: { status: "Checked", score: 800, expiresAt: FUTURE } });
    FranchiseCustomer.findOne.mockResolvedValue(customer);

    const result = await customerService.updateCustomer(FRANCHISE, FC_ID, { panNumber: "ZZZZZ9999Z" });

    expect(customer.panNumber).toBe("ZZZZZ9999Z");
    expect(result.cibil.status).toBe("NotChecked");
    expect(result.loanForm.locked).toBe(true);
    expect(customer.save).toHaveBeenCalled();
  });
});

const stubLoanQueries = (byProduct, method = "find") =>
  Object.entries(MODELS).map(([key, Model]) => {
    if (method === "findOne") {
      return jest.spyOn(Model, "findOne").mockResolvedValue((byProduct[key] || [])[0] || null);
    }
    return jest.spyOn(Model, "find").mockReturnValue({
      sort: jest.fn().mockResolvedValue(byProduct[key] || []),
    });
  });

const loanDoc = (overrides = {}) => ({
  _id: "loan-id",
  applicationNo: "LOAN000031",
  loanType: "Personal Loan",
  loanAmount: 300000,
  loanTenure: 2,
  employmentType: "Salaried",
  fullName: "Rahul Sharma",
  mobile: "9876543210",
  panNumber: "ABCDE1234F",
  status: "Pending",
  adminNote: "",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-02T00:00:00.000Z"),
  ...overrides,
});

describe("franchise apne customer ki detail aur loan status dekhta hai", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("groups the customer's loans per product with the same status view the customer sees", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(
      franchiseCustomerDoc({ cibil: { status: "Checked", score: 790, expiresAt: FUTURE } })
    );
    stubLoanQueries({ personal: [loanDoc()], goldLoan: [loanDoc({ _id: "loan-2", applicationNo: "LOAN000032", status: "Approved" })] });

    const result = await customerService.listCustomerLoans(FRANCHISE, FC_ID);

    expect(result.total).toBe(2);
    expect(result.byStatus).toEqual({ Submitted: 0, Pending: 1, Approved: 1, Rejected: 0 });
    expect(result.customer).toMatchObject({ fullName: "Rahul Sharma", mobile: "9876543210" });
    expect(result.customer.cibil).toMatchObject({ canApplyLoan: true, score: 790 });

    const personalGroup = result.data.find((group) => group.product === "personal");
    expect(personalGroup.count).toBe(1);
    // Wahi stage/timeline jo customer dashboard par dikhta hai.
    expect(personalGroup.applications[0]).toMatchObject({
      applicationNo: "LOAN000031",
      status: "Pending",
      stage: "Under Review",
      stageKey: "under_review",
      step: 2,
    });
    expect(personalGroup.applications[0].timeline.map((step) => step.step)).toEqual([
      "Application Submitted",
      "Under Review",
    ]);

    // Query sirf is franchise ke is customer ke loans par lagi.
    expect(MODELS.personal.find).toHaveBeenCalledWith({ franchiseCustomer: FC_ID, franchise: "frn-id" });
  });

  it("returns an empty tracking view when the customer has no loans yet", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc());
    stubLoanQueries({});

    const result = await customerService.listCustomerLoans(FRANCHISE, FC_ID);

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
    expect(result.byStatus).toEqual({ Submitted: 0, Pending: 0, Approved: 0, Rejected: 0 });
  });

  it("returns one application's status and 404s for an unknown application number", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc());
    stubLoanQueries({ personal: [loanDoc({ status: "Approved", approvedAt: new Date("2026-10-03T00:00:00.000Z") })] }, "findOne");

    const result = await customerService.getCustomerLoan(FRANCHISE, FC_ID, "loan000031");

    expect(result.application).toMatchObject({ applicationNo: "LOAN000031", stageKey: "approved" });
    expect(MODELS.personal.findOne).toHaveBeenCalledWith({
      franchiseCustomer: FC_ID,
      franchise: "frn-id",
      applicationNo: "LOAN000031",
    });

    stubLoanQueries({}, "findOne");
    await expect(customerService.getCustomerLoan(FRANCHISE, FC_ID, "LOAN999999")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("shows each customer's loan count in the franchise customer list", async () => {
    FranchiseCustomer.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([franchiseCustomerDoc()]) });
    Object.values(MODELS).forEach((Model) =>
      jest
        .spyOn(Model, "aggregate")
        .mockResolvedValue(
          Model === MODELS.personal ? [{ _id: FC_ID, count: 2, lastAppliedAt: new Date("2026-10-05T00:00:00.000Z") }] : []
        )
    );

    const result = await customerService.listCustomers(FRANCHISE, {});

    expect(result.data[0].loans).toMatchObject({ count: 2 });
    expect(result.data[0].loans.lastAppliedAt).toEqual(new Date("2026-10-05T00:00:00.000Z"));
    expect(result.unlocked).toBe(0);
  });
});

describe("franchise loan apply is gated by the CIBIL check", () => {
  const payroll = () => ({
    product: "personal",
    franchiseCustomerId: FC_ID,
    loanAmount: 300000,
    loanTenure: 2,
  });

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("blocks the apply with 403 while the check is pending", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc());
    const createSpy = jest.spyOn(MODELS.personal, "create");

    let error;
    try {
      await franchiseService.createFranchiseLoan(FRANCHISE, payroll());
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.statusCode).toBe(403);
    expect(error.lockReason).toMatch(/CIBIL check is pending/i);
    expect(error.cibil).toMatchObject({ status: "NotChecked", locked: true, canApplyLoan: false });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("blocks the apply when the score is too low", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(
      franchiseCustomerDoc({ cibil: { status: "Checked", score: 590, expiresAt: FUTURE } })
    );

    await expect(franchiseService.createFranchiseLoan(FRANCHISE, payroll())).rejects.toMatchObject({
      statusCode: 403,
      lockReason: expect.stringMatching(/below the required threshold/i),
    });
  });

  it("applies the loan once eligible, stamping the franchise customer + FRN", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(
      franchiseCustomerDoc({ cibil: { status: "Checked", score: 790, expiresAt: FUTURE } })
    );
    User.findOne.mockResolvedValue({ _id: "customer-account-id", mobile: "9876543210", role: USER_ROLE.CUSTOMER });

    const createSpy = jest.spyOn(MODELS.personal, "create").mockResolvedValue({
      toObject: () => ({ _id: "loan-id", applicationNo: "LOAN000009", status: "Submitted" }),
    });

    const result = await franchiseService.createFranchiseLoan(FRANCHISE, payroll());

    const document = createSpy.mock.calls[0][0];
    expect(document.user).toBe("customer-account-id");
    expect(document.franchise).toBe("frn-id");
    expect(document.franchiseCode).toBe("FRN000001");
    expect(document.franchiseCustomer).toBe(FC_ID);
    // Applicant details customer profile se aate hain, body se nahi.
    expect(document.fullName).toBe("Rahul Sharma");
    expect(document.mobile).toBe("9876543210");
    expect(document.panNumber).toBe("ABCDE1234F");
    expect(document.dob).toBe("1995-05-15");

    expect(result.cibil).toMatchObject({ canApplyLoan: true, locked: false, score: 790 });
    expect(result.franchiseCustomer._id).toBe(FC_ID);
  });
});
