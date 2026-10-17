const FranchiseCustomer = require("../src/modules/franchise/franchiseCustomer.model");
const mergeFranchiseCustomer = require("../src/middleware/franchiseCustomer.middleware");

jest.mock("../src/modules/franchise/franchiseCustomer.model", () => ({
  findOne: jest.fn(),
}));

const FRANCHISE_ID = "64f000000000000000000002";
const CUSTOMER_ID = "64f000000000000000000001";

const customer = {
  _id: CUSTOMER_ID,
  franchise: FRANCHISE_ID,
  fullName: "Sneha Patil",
  mobile: "9876500001",
  panNumber: "ABCDE1234F",
  dob: new Date("1995-04-20T00:00:00.000Z"),
  email: "sneha@example.com",
  state: "Maharashtra",
  city: "Pune",
  pincode: "411001",
  isVerified: true,
};

const run = async (body, franchise = { _id: FRANCHISE_ID }) => {
  const req = { body, franchise };
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

  let nextCalled = false;
  await mergeFranchiseCustomer(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
};

describe("franchise customer apply middleware", () => {
  beforeEach(() => {
    FranchiseCustomer.findOne.mockReset();
    FranchiseCustomer.findOne.mockResolvedValue(customer);
  });

  it("fills server-owned identity from the customer profile", async () => {
    const { req, nextCalled } = await run({ franchiseCustomerId: CUSTOMER_ID });

    expect(nextCalled).toBe(true);
    expect(req.body.fullName).toBe("Sneha Patil");
    expect(req.body.mobile).toBe("9876500001");
    expect(req.body.panNumber).toBe("ABCDE1234F");
    expect(req.body.email).toBe("sneha@example.com");
    expect(req.body.dob).toBe("1995-04-20");
  });

  it("overrides identity fields sent by the client", async () => {
    const { req } = await run({
      franchiseCustomerId: CUSTOMER_ID,
      fullName: "Someone Else",
      mobile: "9000000000",
    });

    expect(req.body.fullName).toBe("Sneha Patil");
    expect(req.body.mobile).toBe("9876500001");
  });

  it("keeps form address values and fills only the missing ones from the profile", async () => {
    const { req } = await run({
      franchiseCustomerId: CUSTOMER_ID,
      city: "Mumbai",
    });

    expect(req.body.city).toBe("Mumbai");
    expect(req.body.state).toBe("Maharashtra");
    expect(req.body.pincode).toBe("411001");
  });

  it("rejects a missing or invalid franchiseCustomerId", async () => {
    const { res, nextCalled } = await run({});

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(FranchiseCustomer.findOne).not.toHaveBeenCalled();
  });

  it("returns 404 when the customer belongs to another franchise", async () => {
    FranchiseCustomer.findOne.mockResolvedValue(null);

    const { res, nextCalled } = await run({ franchiseCustomerId: CUSTOMER_ID });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 until the customer's mobile is verified", async () => {
    FranchiseCustomer.findOne.mockResolvedValue({ ...customer, isVerified: false });

    const { res, nextCalled } = await run({ franchiseCustomerId: CUSTOMER_ID });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
