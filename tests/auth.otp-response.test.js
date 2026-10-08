jest.mock("../src/modules/auth/user.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
}));
jest.mock("../src/modules/franchise/franchise.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
}));
jest.mock("../src/modules/auth/otp.model", () => ({
  findOne: jest.fn(),
  deleteMany: jest.fn(),
}));
jest.mock("../src/utils/generateToken", () => jest.fn(() => "test-token"));

const User = require("../src/modules/auth/user.model");
const Franchise = require("../src/modules/franchise/franchise.model");
const OTP = require("../src/modules/auth/otp.model");
const authController = require("../src/modules/auth/auth.controller");

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

describe("OTP verification response", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    OTP.findOne.mockResolvedValue({
      otp: "123456",
      expiresAt: new Date(Date.now() + 60_000),
    });
    OTP.deleteMany.mockResolvedValue({});
  });

  it("returns registered franchise account fields without empty application defaults", async () => {
    // Franchise accounts live in the `franchises` collection now.
    OTP.findOne.mockResolvedValue({
      otp: "123456",
      expiresAt: new Date(Date.now() + 60_000),
      role: "Franchise",
    });

    Franchise.findOne.mockResolvedValue({
      _id: "franchise-id",
      name: "Franchise name",
      mobile: "9876543220",
      email: "franchise@example.com",
      isVerified: false,
      role: "Franchise",
      continent: "Asia",
      country: "India",
      isActive: true,
      lastLogin: null,
      createdAt: new Date("2026-10-06T05:57:15.543Z"),
      updatedAt: new Date("2026-10-06T05:59:44.027Z"),
      franchiseStatus: "None",
      panNumber: "",
      state: "",
      city: "",
      pincode: "",
      package: "",
      save: jest.fn().mockResolvedValue(undefined),
    });

    const { response, next } = await runController(authController.verifyOTP, {
      mobile: "9876543220",
      otp: "123456",
    });

    expect(next).not.toHaveBeenCalled();
    expect(response.payload.user).toMatchObject({
      _id: "franchise-id",
      name: "Franchise name",
      mobile: "9876543220",
      email: "franchise@example.com",
      isVerified: true,
      role: "Franchise",
      continent: "Asia",
      country: "India",
    });
    expect(response.payload.user).not.toHaveProperty("franchiseStatus");
    expect(response.payload.user).not.toHaveProperty("panNumber");
    expect(response.payload.nextStep).toBe("franchise-apply");

    // Role hint se sahi collection padhi gayi — customer collection touch bhi nahi hui.
    expect(Franchise.findOne).toHaveBeenCalledWith({ mobile: "9876543220" });
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it("allows another login with a fresh valid OTP (franchise token from franchises)", async () => {
    OTP.findOne.mockResolvedValue({
      otp: "123456",
      expiresAt: new Date(Date.now() + 60_000),
      role: "Franchise",
    });

    const franchise = {
      _id: "franchise-id",
      name: "Franchise name",
      mobile: "9876543220",
      email: "franchise@example.com",
      isVerified: true,
      role: "Franchise",
      continent: "Asia",
      country: "India",
      isActive: true,
      lastLogin: null,
      createdAt: new Date("2026-10-06T05:57:15.543Z"),
      updatedAt: new Date("2026-10-06T05:59:44.027Z"),
      save: jest.fn().mockResolvedValue(undefined),
    };
    Franchise.findOne.mockResolvedValue(franchise);

    const { response, next } = await runController(authController.verifyLoginOTP, {
      mobile: "9876543220",
      otp: "123456",
    });

    expect(next).not.toHaveBeenCalled();
    expect(response.payload).toMatchObject({
      success: true,
      token: "test-token",
      user: {
        name: "Franchise name",
        mobile: "9876543220",
        role: "Franchise",
      },
      nextStep: "franchise-apply",
    });
    expect(OTP.deleteMany).toHaveBeenCalledWith({ mobile: "9876543220" });
  });

  it("still resolves a legacy OTP (no role stored) by searching both collections", async () => {
    User.findOne.mockResolvedValue(null);
    Franchise.findOne.mockResolvedValue({
      _id: "franchise-id",
      name: "Legacy",
      mobile: "9876543220",
      email: "legacy@example.com",
      isVerified: true,
      role: "Franchise",
      franchiseStatus: "Approved",
      save: jest.fn().mockResolvedValue(undefined),
    });

    const { response } = await runController(authController.verifyLoginOTP, {
      mobile: "9876543220",
      otp: "123456",
    });

    expect(response.payload.nextStep).toBe("franchise-dashboard");
  });

  it("rejects an expired login OTP", async () => {
    OTP.findOne.mockResolvedValue({
      otp: "123456",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const { response, next } = await runController(authController.verifyLoginOTP, {
      mobile: "9876543220",
      otp: "123456",
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload.message).toBe("OTP Expired");
    expect(User.findOne).not.toHaveBeenCalled();
    expect(Franchise.findOne).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
