jest.mock("../src/modules/franchise/franchiseCustomer.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
}));
jest.mock("../src/modules/franchise/franchise.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
}));

const mongoose = require("mongoose");

const FranchiseCustomer = require("../src/modules/franchise/franchiseCustomer.model");
const Franchise = require("../src/modules/franchise/franchise.model");
const adminService = require("../src/modules/admin/franchiseCustomer.service");
const adminController = require("../src/modules/admin/franchiseCustomer.controller");
const { MODELS } = require("../src/modules/loans/shared/loanModels");

const FC_ID = new mongoose.Types.ObjectId().toString();
const FRN_ID = new mongoose.Types.ObjectId().toString();
const OTHER_FRN_ID = new mongoose.Types.ObjectId().toString();

const customerDoc = (overrides = {}) => ({
  _id: FC_ID,
  franchise: FRN_ID,
  franchiseCode: "FRN000001",
  fullName: "Rahul Sharma",
  mobile: "9876543210",
  panNumber: "ABCDE1234F",
  email: "rahul@example.com",
  dob: new Date("1995-05-15"),
  toObject() {
    const { toObject, save, ...rest } = this;
    return rest;
  },
  ...overrides,
});

const ownerFranchise = {
  _id: FRN_ID,
  name: "Amit",
  franchiseId: "FRN000001",
  franchiseStatus: "Approved",
};

/*
find().sort().skip().limit() chain ka query-shaped mock. Mongoose Query
thenable hota hai — service `await query` karti hai, isliye `then` bhi.
*/
const listQuery = (docs) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockResolvedValue(docs),
  then(onFulfilled, onRejected) {
    return Promise.resolve(docs).then(onFulfilled, onRejected);
  },
});

const runController = async (handler, req) => {
  const response = {
    statusCode: 200,
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

  await handler(req, response, next);

  return { response, next };
};

describe("admin franchise customer list", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("lists customers across franchises with owner FRN and loan counts", async () => {
    FranchiseCustomer.find.mockReturnValue(listQuery([customerDoc()]));
    Franchise.find.mockReturnValue({ select: jest.fn().mockResolvedValue([ownerFranchise]) });
    Object.values(MODELS).forEach((Model) =>
      jest
        .spyOn(Model, "aggregate")
        .mockResolvedValue(
          Model === MODELS.personal
            ? [{ _id: FC_ID, count: 2, lastAppliedAt: new Date("2026-10-05T00:00:00.000Z") }]
            : []
        )
    );

    const rows = await adminService.listFranchiseCustomers({ page: 1, limit: 10 });

    expect(FranchiseCustomer.find).toHaveBeenCalledWith({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fullName: "Rahul Sharma",
      franchise: { name: "Amit", franchiseId: "FRN000001", franchiseStatus: "Approved" },
      loans: { count: 2 },
    });
    expect(rows[0]).not.toHaveProperty("cibil");
  });

  it("builds the FRN + search filters in one query", async () => {
    FranchiseCustomer.find.mockReturnValue(listQuery([]));

    await adminService.listFranchiseCustomers({ franchise: "frn000001", search: "rahul", page: 2, limit: 5 });

    const filter = FranchiseCustomer.find.mock.calls[0][0];
    expect(filter.franchiseCode).toEqual(/^FRN000001$/i);
    expect(filter.$or).toEqual([
      { fullName: /rahul/i },
      { mobile: /rahul/i },
      { panNumber: /rahul/i },
      { email: /rahul/i },
    ]);
  });

  it("accepts a franchise id and rejects an invalid franchise filter with 400", async () => {
    FranchiseCustomer.find.mockReturnValue(listQuery([]));

    await adminService.listFranchiseCustomers({ franchise: FRN_ID });
    expect(FranchiseCustomer.find).toHaveBeenCalledWith({ franchise: FRN_ID });

    await expect(adminService.listFranchiseCustomers({ franchise: "not-a-frn" })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("counts with the very same filter the list uses", async () => {
    FranchiseCustomer.countDocuments.mockResolvedValue(42);

    const total = await adminService.countFranchiseCustomers({ search: "rahul" });

    expect(total).toBe(42);
    expect(FranchiseCustomer.countDocuments).toHaveBeenCalledWith({
      $or: [{ fullName: /rahul/i }, { mobile: /rahul/i }, { panNumber: /rahul/i }, { email: /rahul/i }],
    });
  });

  it("returns pagination metadata from the controller", async () => {
    FranchiseCustomer.find.mockReturnValue(listQuery([customerDoc()]));
    FranchiseCustomer.countDocuments.mockResolvedValue(7);
    Franchise.find.mockReturnValue({ select: jest.fn().mockResolvedValue([ownerFranchise]) });
    Object.values(MODELS).forEach((Model) => jest.spyOn(Model, "aggregate").mockResolvedValue([]));

    const { response, next } = await runController(adminController.list, {
      query: { page: "2", limit: "10" },
    });

    expect(next).not.toHaveBeenCalled();
    expect(response.payload).toMatchObject({ success: true, total: 7, page: 2, limit: 10, totalPages: 1 });
    expect(response.payload.customers).toHaveLength(1);
  });

  it("forwards filter validation errors to next()", async () => {
    const { response, next } = await runController(adminController.list, {
      query: { franchise: "not-a-frn" },
    });

    expect(response.payload).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe("admin franchise customer stats", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sums franchise-wise rows into an overall total and joins the FRN names", async () => {
    FranchiseCustomer.aggregate.mockResolvedValue([
      { _id: FRN_ID, total: 3 },
      { _id: OTHER_FRN_ID, total: 1 },
    ]);
    Franchise.find.mockReturnValue({ select: jest.fn().mockResolvedValue([ownerFranchise]) });

    const stats = await adminService.franchiseCustomerStats();

    expect(stats.total).toBe(4);
    expect(stats.byFranchise).toHaveLength(2);
    expect(stats.byFranchise[0]).toMatchObject({
      franchise: { franchiseId: "FRN000001" },
      total: 3,
    });
    // Doosra franchise doc nahi mila (delete ho gaya) — row phir bhi dikhti hai.
    expect(stats.byFranchise[1].franchise).toBeNull();

    // Count aggregation me hi lagta hai.
    const group = FranchiseCustomer.aggregate.mock.calls[0][0][0].$group;
    expect(group.total).toEqual({ $sum: 1 });
  });

  it("returns zeros when no franchise has customers yet", async () => {
    FranchiseCustomer.aggregate.mockResolvedValue([]);

    const stats = await adminService.franchiseCustomerStats();

    expect(stats.total).toBe(0);
    expect(stats.byFranchise).toEqual([]);
    expect(Franchise.find).not.toHaveBeenCalled();
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

describe("admin customer detail (owner + loans)", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("returns the customer, the owning franchise and the same loan status view", async () => {
    FranchiseCustomer.findById.mockResolvedValue(customerDoc());
    FranchiseCustomer.findOne.mockResolvedValue(customerDoc());
    Franchise.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(ownerFranchise) });
    jest.spyOn(MODELS.personal, "find").mockReturnValue({
      sort: jest.fn().mockResolvedValue([loanDoc()]),
    });
    Object.values(MODELS)
      .filter((Model) => Model !== MODELS.personal)
      .forEach((Model) => jest.spyOn(Model, "find").mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }));

    const result = await adminService.getFranchiseCustomer(FC_ID);

    expect(Franchise.findById).toHaveBeenCalledWith(FRN_ID);
    expect(result.customer).toMatchObject({ fullName: "Rahul Sharma" });
    expect(result.customer).not.toHaveProperty("cibil");
    expect(result.franchise).toMatchObject({ franchiseId: "FRN000001", name: "Amit" });

    // Loans usi franchise + usi customer par scoped.
    expect(MODELS.personal.find).toHaveBeenCalledWith({ franchiseCustomer: FC_ID, franchise: FRN_ID });
    expect(result.loans.total).toBe(1);
    expect(result.loans.byStatus).toMatchObject({ Pending: 1 });
    expect(result.loans.data[0]).toMatchObject({
      product: "personal",
      applications: [expect.objectContaining({ applicationNo: "LOAN000031", stageKey: "under_review" })],
    });
  });

  it("404s for an unknown id and for a malformed id", async () => {
    FranchiseCustomer.findById.mockResolvedValue(null);

    await expect(adminService.getFranchiseCustomer(FC_ID)).rejects.toMatchObject({ statusCode: 404 });
    await expect(adminService.getFranchiseCustomer("nope")).rejects.toMatchObject({ statusCode: 404 });
    expect(FranchiseCustomer.findById).toHaveBeenCalledTimes(1);
  });

  it("shapes the detail response from the controller", async () => {
    FranchiseCustomer.findById.mockResolvedValue(customerDoc());
    FranchiseCustomer.findOne.mockResolvedValue(customerDoc());
    Franchise.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(ownerFranchise) });
    Object.values(MODELS).forEach((Model) =>
      jest.spyOn(Model, "find").mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })
    );

    const { response, next } = await runController(adminController.getOne, { params: { id: FC_ID } });

    expect(next).not.toHaveBeenCalled();
    expect(response.payload).toMatchObject({
      success: true,
      franchise: { franchiseId: "FRN000001" },
      loans: { total: 0, byStatus: { Submitted: 0, Pending: 0, Approved: 0, Rejected: 0 } },
    });
    expect(response.payload.customer.fullName).toBe("Rahul Sharma");
  });
});
