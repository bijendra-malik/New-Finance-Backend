jest.mock("../src/modules/auth/user.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../src/modules/franchise/franchise.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../src/modules/auth/otp.model", () => ({
  findOne: jest.fn(),
  deleteMany: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../src/utils/sendOTP", () => jest.fn(async () => true));
jest.mock("../src/utils/generateToken", () => jest.fn(() => "test-token"));

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const User = require("../src/modules/auth/user.model");
const Franchise = require("../src/modules/franchise/franchise.model");
const OTP = require("../src/modules/auth/otp.model");
const authController = require("../src/modules/auth/auth.controller");
const franchiseService = require("../src/modules/franchise/franchise.service");
const adminFranchiseService = require("../src/modules/admin/franchise.service");
const { requireApprovedFranchise } = require("../src/middleware/franchise.middleware");
const { USER_ROLE } = require("../src/constants/roles");

const runController = async (handler, body) => {
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

  await handler({ body }, response, next);

  return { response, next };
};

const runGuard = (middleware, user) =>
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

    let index = 0;
    const step = () => {
      if (index >= middleware.length) return resolve({ allowed: true, req });
      middleware[index++](req, res, step);
    };
    step();
  });

describe("register routes each role into its own collection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    OTP.deleteMany.mockResolvedValue({});
    OTP.create.mockResolvedValue({});
  });

  const franchisePayload = {
    role: USER_ROLE.FRANCHISE,
    continent: "Asia",
    country: "India",
    name: "Amit",
    mobile: "9876543222",
    email: "amit@example.com",
  };

  it("creates a franchise account in `franchises` and stores the role on the OTP", async () => {
    User.findOne.mockResolvedValue(null);
    Franchise.findOne.mockResolvedValue(null);
    Franchise.create.mockResolvedValue({});

    const { response, next } = await runController(authController.register, franchisePayload);

    expect(next).not.toHaveBeenCalled();
    expect(response.payload).toMatchObject({ success: true, message: "OTP sent successfully" });

    expect(Franchise.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Amit", mobile: "9876543222", email: "amit@example.com", isVerified: false })
    );
    expect(User.create).not.toHaveBeenCalled();
    expect(OTP.create).toHaveBeenCalledWith(expect.objectContaining({ mobile: "9876543222", role: USER_ROLE.FRANCHISE }));
  });

  it("creates a customer account in `users`", async () => {
    Franchise.findOne.mockResolvedValue(null);
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({});

    const { response } = await runController(authController.register, {
      ...franchisePayload,
      role: USER_ROLE.CUSTOMER,
    });

    expect(response.payload.success).toBe(true);
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ mobile: "9876543222" }));
    expect(Franchise.create).not.toHaveBeenCalled();
    expect(OTP.create).toHaveBeenCalledWith(expect.objectContaining({ role: USER_ROLE.CUSTOMER }));
  });

  it("refuses to register a franchise on a mobile that is already a customer", async () => {
    // Same mobile dono collections me nahi ho sakta — warna login ambiguous ho jaata.
    User.findOne.mockResolvedValue({ mobile: "9876543222", isVerified: true });

    const { response, next } = await runController(authController.register, franchisePayload);

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.payload.message).toMatch(/already registered as a customer/i);
    expect(Franchise.create).not.toHaveBeenCalled();
    expect(OTP.create).not.toHaveBeenCalled();
  });

  it("refuses to register a customer on a mobile that is already a franchise", async () => {
    Franchise.findOne.mockResolvedValue({ mobile: "9876543222", isVerified: true });

    const { response } = await runController(authController.register, {
      ...franchisePayload,
      role: USER_ROLE.CUSTOMER,
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload.message).toMatch(/already registered as a franchise/i);
    expect(User.create).not.toHaveBeenCalled();
  });

  it("tells a verified franchise to login instead of registering again", async () => {
    User.findOne.mockResolvedValue(null);
    Franchise.findOne.mockResolvedValue({ mobile: "9876543222", isVerified: true });

    const { response } = await runController(authController.register, franchisePayload);

    expect(response.statusCode).toBe(400);
    expect(response.payload.message).toBe("Franchise already registered. Please login instead.");
  });
});

describe("franchise login reads the franchises collection", () => {
  beforeEach(() => jest.clearAllMocks());

  it("login reads the franchise by FRN and mints a token with the FRN claim", async () => {
    const hashed = await bcrypt.hash("9876543210", 10);
    const franchise = {
      _id: "frn-id",
      name: "Amit",
      mobile: "9876543210",
      role: USER_ROLE.FRANCHISE,
      franchiseId: "FRN000001",
      franchiseStatus: "Approved",
      password: hashed,
      save: jest.fn().mockResolvedValue(undefined),
      toObject() {
        return { ...this, save: undefined };
      },
    };
    Franchise.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(franchise) });

    const result = await franchiseService.loginFranchise("frn000001", "9876543210");

    expect(Franchise.findOne).toHaveBeenCalledWith({ franchiseId: "FRN000001" });
    expect(result.token).toBe("test-token");
    expect(result.franchise).not.toHaveProperty("password");
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it("blocks a franchise that is not approved yet", async () => {
    Franchise.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: "frn-id",
        role: USER_ROLE.FRANCHISE,
        franchiseId: "FRN000002",
        franchiseStatus: "Pending",
        password: await bcrypt.hash("9876543210", 10),
        save: jest.fn(),
      }),
    });

    await expect(franchiseService.loginFranchise("FRN000002", "9876543210")).rejects.toThrow(
      /not approved yet/i
    );
  });
});

describe("admin franchise management reads the franchises collection", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists franchise applications from `franchises` with the status filter", async () => {
    const sort = jest.fn().mockResolvedValue([]);
    Franchise.find.mockReturnValue({ sort });

    const result = await adminFranchiseService.listFranchises({ status: "Approved" });

    expect(Franchise.find).toHaveBeenCalledWith({ franchiseStatus: "Approved" });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(result).toEqual([]);
  });

  it("approving mints the FRN code and stores the PAN as a bcrypt password", async () => {
    const franchise = {
      _id: new mongoose.Types.ObjectId(),
      name: "Amit",
      mobile: "9876543210",
      role: USER_ROLE.FRANCHISE,
      panNumber: "ABCDE1234F",
      franchiseStatus: "Pending",
      save: jest.fn().mockResolvedValue(undefined),
      toObject() {
        return { ...this, save: undefined };
      },
    };
    Franchise.findOne.mockResolvedValue(franchise);

    const approved = await adminFranchiseService.approveFranchise(franchise._id.toString());

    expect(approved.franchiseId).toMatch(/^FRN\d{6}$/);
    expect(approved.franchiseStatus).toBe("Approved");
    expect(franchise.password).toMatch(/^\$2/);
    expect(await bcrypt.compare("ABCDE1234F", franchise.password)).toBe(true);
    expect(franchise.save).toHaveBeenCalled();

    // Hash kabhi response me nahi jaata.
    expect(approved).not.toHaveProperty("password");
  });
});

describe("approval gate before any loan can be filed", () => {
  beforeEach(() => jest.clearAllMocks());

  it("403s while the franchise is Pending", async () => {
    Franchise.findById.mockResolvedValue({
      _id: "frn-id",
      role: USER_ROLE.FRANCHISE,
      franchiseStatus: "Pending",
    });

    const result = await runGuard(requireApprovedFranchise, { id: "frn-id", role: USER_ROLE.FRANCHISE });

    expect(result.allowed).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.payload.message).toMatch(/not approved yet/i);
    expect(Franchise.findById).toHaveBeenCalledWith("frn-id");
  });

  it("403s with the rejected message when the application was rejected", async () => {
    Franchise.findById.mockResolvedValue({
      _id: "frn-id",
      role: USER_ROLE.FRANCHISE,
      franchiseStatus: "Rejected",
    });

    const result = await runGuard(requireApprovedFranchise, { id: "frn-id", role: USER_ROLE.FRANCHISE });

    expect(result.statusCode).toBe(403);
    expect(result.payload.message).toMatch(/rejected/i);
  });

  it("lets an Approved franchise through and loads it onto req.franchise", async () => {
    Franchise.findById.mockResolvedValue({
      _id: "frn-id",
      role: USER_ROLE.FRANCHISE,
      franchiseId: "FRN000001",
      franchiseStatus: "Approved",
    });

    const result = await runGuard(requireApprovedFranchise, { id: "frn-id", role: USER_ROLE.FRANCHISE });

    expect(result.allowed).toBe(true);
    expect(result.req.franchise).toMatchObject({ franchiseId: "FRN000001" });
  });

  it("403s a legacy franchise document still sitting in the users collection", async () => {
    // Migration se pehle ka account: franchises collection me nahi milta.
    Franchise.findById.mockResolvedValue(null);

    const result = await runGuard(requireApprovedFranchise, { id: "legacy-id", role: USER_ROLE.FRANCHISE });

    expect(result.allowed).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.payload.message).toMatch(/not found/i);
  });
});
