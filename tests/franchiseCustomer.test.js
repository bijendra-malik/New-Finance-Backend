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
jest.mock("../src/modules/auth/user.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));

const mongoose = require("mongoose");

const FranchiseCustomer = require("../src/modules/franchise/franchiseCustomer.model");
const Franchise = require("../src/modules/franchise/franchise.model");
const User = require("../src/modules/auth/user.model");
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
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc());
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
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc());
    stubLoanQueries({});

    const result = await customerService.listCustomerLoans(FRANCHISE, FC_ID);

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
    expect(result.byStatus).toEqual({ Submitted: 0, Pending: 0, Approved: 0, Rejected: 0 });
  });

  it("returns one application's status and 404s for an unknown application number", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc());
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
      franchiseService.createFranchiseLoan(FRANCHISE, { product: "personal", loanAmount: 300000, loanTenure: 2 })
    ).rejects.toThrow(/franchiseCustomerId is required/i);
  });

  it("applies the loan straight away, stamping the franchise customer + FRN", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(franchiseCustomerDoc());
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

    expect(result).not.toHaveProperty("cibil");
    expect(result.franchiseCustomer._id).toBe(FC_ID);
  });
});
