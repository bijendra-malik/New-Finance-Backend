jest.mock("../src/modules/franchise/franchiseCustomer.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
}));
jest.mock("../src/modules/franchise/franchise.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
}));
jest.mock("../src/modules/franchise/franchiseCustomerLoanDraft.model", () => ({
  ensureExpiryIndex: jest.fn().mockResolvedValue(undefined),
  create: jest.fn(),
  findOne: jest.fn(),
  deleteOne: jest.fn(),
}));
jest.mock("../src/modules/auth/user.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));
/*
Register ab customer ke phone par OTP bhejta hai (entry engine). Test me SMS/DB
nahi chahiye, isliye OTP model aur sendOTP stub kar diye jate hain.
*/
jest.mock("../src/modules/auth/otp.model", () => ({
  findOne: jest.fn(),
  create: jest.fn().mockResolvedValue({}),
  deleteMany: jest.fn().mockResolvedValue({}),
}));
jest.mock("../src/utils/sequence", () => ({
  nextLoanApplicationNo: jest.fn().mockResolvedValue("LOAN000009"),
  nextCustomerId: jest.fn().mockResolvedValue("CUST000001"),
}));
jest.mock("../src/utils/sendOTP", () => jest.fn(async () => true));

const mongoose = require("mongoose");

const FranchiseCustomer = require("../src/modules/franchise/franchiseCustomer.model");
const Franchise = require("../src/modules/franchise/franchise.model");
const FranchiseCustomerLoanDraft = require("../src/modules/franchise/franchiseCustomerLoanDraft.model");
const User = require("../src/modules/auth/user.model");
const OTP = require("../src/modules/auth/otp.model");
const sendOTP = require("../src/utils/sendOTP");
const customerService = require("../src/modules/franchise/franchiseCustomer.service");
const franchiseService = require("../src/modules/franchise/franchise.service");
const { MODELS } = require("../src/modules/loans/shared/loanModels");
const { USER_ROLE } = require("../src/constants/roles");

const FRANCHISE = { _id: "frn-id", franchiseId: "FRN000001", franchiseStatus: "Approved" };
// Service `mongoose.isValidObjectId` check karti hai, isliye real ObjectId ids.
const FC_ID = new mongoose.Types.ObjectId().toString();
const OTHER_ID = new mongoose.Types.ObjectId().toString();

const franchiseCustomerDoc = (overrides = {}) => ({
  _id: FC_ID,
  franchise: "frn-id",
  franchiseCode: "FRN000001",
  fullName: "Rahul Sharma",
  mobile: "9876543210",
  email: "rahul@example.com",
  panNumber: "ABCDE1234F",
  dob: new Date("1995-05-15"),
  save: jest.fn().mockResolvedValue(undefined),
  toObject() {
    const { save, toObject, ...rest } = this;
    return rest;
  },
  ...overrides,
});

/*
find().sort().skip().limit() chain ka query-shaped mock. Mongoose Query thenable
hota hai — service `await query` karti hai, isliye `then` bhi chahiye.
*/
const listQuery = (docs) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockResolvedValue(docs),
  then(onFulfilled, onRejected) {
    return Promise.resolve(docs).then(onFulfilled, onRejected);
  },
});

describe("franchise customer register", () => {
  beforeEach(() => jest.clearAllMocks());

  const payload = {
    fullName: "Rahul Sharma",
    mobile: "9876543210",
    panNumber: "abcde1234f",
    dob: "1995-05-15",
    email: "Rahul@Example.com",
    city: "Pune",
  };

  it("saves the basic details scoped to the franchise (no bureau fields)", async () => {
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
      })
    );
    expect(FranchiseCustomer.create.mock.calls[0][0]).not.toHaveProperty("cibil");
    expect(result).toMatchObject({ fullName: "Rahul Sharma", panNumber: "ABCDE1234F" });
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

describe("franchise customer OTP resend", () => {
  beforeEach(() => jest.clearAllMocks());

  it("resends an OTP for the same unverified customer", async () => {
    const customer = franchiseCustomerDoc();
    FranchiseCustomer.findOne.mockResolvedValue(customer);
    OTP.create.mockResolvedValue({});
    sendOTP.mockResolvedValue(true);

    const result = await customerService.resendCustomerOtp(FRANCHISE, {
      franchiseCustomerId: FC_ID,
    });

    expect(OTP.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mobile: customer.mobile,
        role: USER_ROLE.CUSTOMER,
        franchise: FRANCHISE._id,
        franchiseCustomer: customer._id,
      })
    );
    expect(sendOTP).toHaveBeenCalledWith(customer.mobile, expect.any(String));
    expect(result).toMatchObject({ nextStep: "verify-otp" });
  });
});

describe("franchise customer update", () => {
  beforeEach(() => jest.clearAllMocks());

  it("updates the profile fields and persists the document", async () => {
    const customer = franchiseCustomerDoc();
    FranchiseCustomer.findOne.mockResolvedValue(customer);

    const result = await customerService.updateCustomer(FRANCHISE, FC_ID, {
      panNumber: "ZZZZZ9999Z",
      city: "Mumbai",
    });

    expect(customer.panNumber).toBe("ZZZZZ9999Z");
    expect(customer.city).toBe("Mumbai");
    expect(customer.save).toHaveBeenCalled();
    expect(result).toMatchObject({ panNumber: "ZZZZZ9999Z", city: "Mumbai" });
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
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc({ isVerified: true }));
    stubLoanQueries({
      personal: [loanDoc()],
      goldLoan: [loanDoc({ _id: "loan-2", applicationNo: "LOAN000032", status: "Approved" })],
    });

    const result = await customerService.listCustomerLoans(FRANCHISE, FC_ID);

    expect(result.total).toBe(2);
    expect(result.byStatus).toEqual({ Submitted: 0, Pending: 1, Approved: 1, Rejected: 0 });
    expect(result.customer).toMatchObject({ fullName: "Rahul Sharma", mobile: "9876543210" });
    expect(result.customer).not.toHaveProperty("cibil");

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

    // Query sirf is franchise ke is customer ke loans par lagi.
    expect(MODELS.personal.find).toHaveBeenCalledWith({ franchiseCustomer: FC_ID, franchise: "frn-id" });
  });

  it("returns an empty tracking view when the customer has no loans yet", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc({ isVerified: true }));
    stubLoanQueries({});

    const result = await customerService.listCustomerLoans(FRANCHISE, FC_ID);

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
    expect(result.byStatus).toEqual({ Submitted: 0, Pending: 0, Approved: 0, Rejected: 0 });
  });

  it("returns one application's status and 404s for an unknown application number", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc({ isVerified: true }));
    stubLoanQueries(
      { personal: [loanDoc({ status: "Approved", approvedAt: new Date("2026-10-03T00:00:00.000Z") })] },
      "findOne"
    );

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

  it("paginates the customer list and reports the true total + per-customer loan count", async () => {
    FranchiseCustomer.find.mockReturnValue(listQuery([franchiseCustomerDoc()]));
    FranchiseCustomer.countDocuments.mockResolvedValue(12);
    Object.values(MODELS).forEach((Model) =>
      jest
        .spyOn(Model, "aggregate")
        .mockResolvedValue(
          Model === MODELS.personal
            ? [{ _id: FC_ID, count: 2, lastAppliedAt: new Date("2026-10-05T00:00:00.000Z") }]
            : []
        )
    );

    const result = await customerService.listCustomers(FRANCHISE, { page: 3, limit: 5 });

    // Count alag query se — pagination ke baad sirf page length nahi.
    expect(FranchiseCustomer.countDocuments).toHaveBeenCalledWith({ franchise: "frn-id" });
    expect(result).toMatchObject({ total: 12, page: 3, limit: 5, totalPages: 3 });
    expect(result.data[0].loans).toMatchObject({ count: 2 });
    expect(result.data[0]).not.toHaveProperty("cibil");
  });
});

describe("franchise loan apply", () => {
  const payroll = () => ({
    product: "personal",
    franchiseCustomerId: FC_ID,
    loanAmount: 300000,
    loanTenure: 2,
  });

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("requires the franchise customer id", async () => {
    await expect(
      franchiseService.createFranchiseLoanDraft(FRANCHISE, { product: "personal", loanAmount: 300000, loanTenure: 2 })
    ).rejects.toThrow(/franchiseCustomerId is required/i);
  });

  it("saves the verified customer's loan form as a draft before credit-score submission", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc({ isVerified: true }));
    User.findOne.mockResolvedValue({ _id: "customer-account-id", mobile: "9876543210", role: USER_ROLE.CUSTOMER });
    FranchiseCustomerLoanDraft.findOne.mockResolvedValue(null);
    const createSpy = jest.spyOn(MODELS.personal, "create");
    FranchiseCustomerLoanDraft.create.mockResolvedValue({
      _id: "draft-record-id",
      draftId: "8f87a217-4568-4d7c-8b2d-7a1523bbdf19",
      createdAt: new Date("2026-10-23T00:00:00.000Z"),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const result = await franchiseService.createFranchiseLoanDraft(FRANCHISE, payroll());

    expect(FranchiseCustomerLoanDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        franchise: FRANCHISE._id,
        franchiseCustomer: FC_ID,
        draftId: expect.any(String),
        product: "personal",
        expiresAt: expect.any(Date),
        payload: expect.objectContaining({
          fullName: "Rahul Sharma",
          mobile: "9876543210",
          panNumber: "ABCDE1234F",
          dob: "1995-05-15",
        }),
      })
    );
    expect(createSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      product: "personal",
      draftId: "8f87a217-4568-4d7c-8b2d-7a1523bbdf19",
      createdAt: new Date("2026-10-23T00:00:00.000Z"),
      expiresAt: expect.any(Date),
      franchiseCustomer: { _id: FC_ID },
    });
  });

  it("does not replace an existing customer draft when another application is started", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc({ isVerified: true }));
    User.findOne.mockResolvedValue({ _id: "customer-account-id", mobile: "9876543210", role: USER_ROLE.CUSTOMER });
    FranchiseCustomerLoanDraft.findOne.mockResolvedValue({
      draftId: "existing-draft-id",
      product: "business",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(franchiseService.createFranchiseLoanDraft(FRANCHISE, payroll())).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/resume or cancel/i),
    });
    expect(FranchiseCustomerLoanDraft.create).not.toHaveBeenCalled();
  });

  it("creates the loan only after an eligible score is submitted for the active draft", async () => {
    const customer = franchiseCustomerDoc({ isVerified: true });
    const account = {
      _id: "customer-account-id",
      mobile: customer.mobile,
      role: USER_ROLE.CUSTOMER,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const draft = {
      _id: "draft-record-id",
      draftId: "8f87a217-4568-4d7c-8b2d-7a1523bbdf19",
      product: "personal",
      payload: payroll(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    FranchiseCustomer.findOne.mockResolvedValue(customer);
    FranchiseCustomerLoanDraft.findOne.mockResolvedValue(draft);
    FranchiseCustomerLoanDraft.deleteOne.mockResolvedValue({ deletedCount: 1 });
    User.findOne.mockResolvedValue(account);
    const createSpy = jest.spyOn(MODELS.personal, "create").mockResolvedValue({
      toObject: () => ({ _id: "loan-id", applicationNo: "LOAN000009", status: "Submitted" }),
    });

    const result = await customerService.submitCustomerCreditScore(
      FRANCHISE,
      FC_ID,
      draft.draftId,
      720
    );

    expect(FranchiseCustomerLoanDraft.findOne).toHaveBeenCalledWith({
      franchise: FRANCHISE._id,
      franchiseCustomer: FC_ID,
      draftId: draft.draftId,
      expiresAt: { $gt: expect.any(Date) },
    });
    expect(account.save).toHaveBeenCalled();
    expect(createSpy.mock.calls[0][0]).toMatchObject({
      user: "customer-account-id",
      franchise: FRANCHISE._id,
      franchiseCode: FRANCHISE.franchiseId,
      franchiseCustomer: FC_ID,
      creditScore: 720,
    });
    expect(FranchiseCustomerLoanDraft.deleteOne).toHaveBeenCalled();
    expect(result).toMatchObject({ eligible: true, product: "personal", nextStep: "complete" });
    expect(result.application.applicationNo).toBe("LOAN000009");
  });

  it("saves a rejected loan (status Rejected + reason) when the score is below eligibility", async () => {
    const customer = franchiseCustomerDoc({ isVerified: true });
    const account = {
      _id: "customer-account-id",
      mobile: customer.mobile,
      role: USER_ROLE.CUSTOMER,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const draft = {
      _id: "draft-record-id",
      draftId: "8f87a217-4568-4d7c-8b2d-7a1523bbdf19",
      product: "personal",
      payload: payroll(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    FranchiseCustomer.findOne.mockResolvedValue(customer);
    FranchiseCustomerLoanDraft.findOne.mockResolvedValue(draft);
    FranchiseCustomerLoanDraft.deleteOne.mockResolvedValue({ deletedCount: 1 });
    User.findOne.mockResolvedValue(account);
    const createSpy = jest.spyOn(MODELS.personal, "create").mockResolvedValue({
      toObject: () => ({ _id: "loan-id", applicationNo: "LOAN000009", status: "Rejected" }),
    });

    const result = await customerService.submitCustomerCreditScore(
      FRANCHISE,
      FC_ID,
      draft.draftId,
      550
    );

    /*
    Contract: score < 600 par application ABHI BANTI hai, par status
    "Rejected" + reason (adminNote) ke saath — admin ki Reject Loans list me
    dikhti hai aur 3 din baad TTL se apne aap delete ho jaati hai.
    */
    expect(createSpy).toHaveBeenCalledTimes(1);
    const saved = createSpy.mock.calls[0][0];
    expect(saved).toMatchObject({
      status: "Rejected",
      user: "customer-account-id",
      franchise: FRANCHISE._id,
      franchiseCode: FRANCHISE.franchiseId,
      franchiseCustomer: FC_ID,
      creditScore: 550,
      creditEligible: false,
    });
    expect(saved.adminNote).toContain("below 600");
    expect(saved.rejectedAt).toBeInstanceOf(Date);
    expect(saved.autoRejectedAt).toBeInstanceOf(Date);

    expect(FranchiseCustomerLoanDraft.deleteOne).toHaveBeenCalled();
    expect(result).toMatchObject({
      eligible: false,
      rejected: true,
      draftRetained: false,
      product: "personal",
      nextStep: "credit-score",
      applicationNo: "LOAN000009",
    });
  });

  it("returns a pending draft for resume and cancels it only for its franchise customer", async () => {
    const customer = franchiseCustomerDoc({ isVerified: true });
    const draft = {
      draftId: "8f87a217-4568-4d7c-8b2d-7a1523bbdf19",
      product: "business",
      payload: { loanAmount: 2500000 },
      createdAt: new Date("2026-10-20T00:00:00.000Z"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      updatedAt: new Date("2026-10-20T00:00:00.000Z"),
    };
    FranchiseCustomer.findOne.mockResolvedValue(customer);
    FranchiseCustomerLoanDraft.findOne.mockResolvedValue(draft);
    FranchiseCustomerLoanDraft.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const resumed = await customerService.getCustomerLoanDraft(FRANCHISE, FC_ID);
    expect(resumed).toMatchObject({
      hasPendingDraft: true,
      nextStep: "credit-score",
      draft: {
        draftId: draft.draftId,
        product: "business",
        data: draft.payload,
        expiresAt: draft.expiresAt,
      },
    });

    const cancelled = await customerService.cancelCustomerLoanDraft(FRANCHISE, FC_ID);
    expect(FranchiseCustomerLoanDraft.deleteOne).toHaveBeenCalledWith({
      franchise: FRANCHISE._id,
      franchiseCustomer: FC_ID,
    });
    expect(cancelled.franchiseCustomerId).toBe(FC_ID);
  });

  it("expires an old draft after 24 hours so the customer can fill the form again without OTP", async () => {
    const customer = franchiseCustomerDoc({ isVerified: true });
    FranchiseCustomer.findOne.mockResolvedValue(customer);
    FranchiseCustomerLoanDraft.findOne.mockResolvedValue({
      _id: "expired-draft",
      draftId: "expired-draft-id",
      expiresAt: new Date(Date.now() - 1000),
    });
    FranchiseCustomerLoanDraft.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const account = {
      _id: "customer-account-id",
      mobile: customer.mobile,
      role: USER_ROLE.CUSTOMER,
    };
    User.findOne.mockResolvedValue(account);

    const result = await customerService.getCustomerLoanDraft(FRANCHISE, FC_ID);

    expect(result).toMatchObject({ hasPendingDraft: false, nextStep: "loan-apply", draft: null });
    expect(FranchiseCustomerLoanDraft.deleteOne).toHaveBeenCalledWith({
      _id: "expired-draft",
      franchise: FRANCHISE._id,
      franchiseCustomer: FC_ID,
    });
    expect(customer.isVerified).toBe(true);
  });
});
