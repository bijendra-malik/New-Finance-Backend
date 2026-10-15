jest.mock("../src/modules/auth/user.model", () => {
  const User = jest.fn(function User(data) {
    Object.assign(this, data);
    this._id = "user-id";
    this.save = jest.fn().mockResolvedValue(this);
  });
  User.findOne = jest.fn();
  return User;
});
jest.mock("../src/modules/franchise/franchise.model", () => ({ findOne: jest.fn() }));
jest.mock("../src/modules/auth/otp.model", () => ({
  findOne: jest.fn(),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
}));
jest.mock("../src/utils/sendOTP", () => jest.fn());
jest.mock("../src/utils/generateToken", () => jest.fn(() => "test-token"));
jest.mock("../src/modules/franchise/franchisePlan.service", () => ({}));
jest.mock("../src/utils/sequence", () => ({ nextCustomerId: jest.fn().mockResolvedValue("CUST000001") }));

const User = require("../src/modules/auth/user.model");
const OTP = require("../src/modules/auth/otp.model");
const { USER_ROLE } = require("../src/constants/roles");
const { verifyEntry } = require("../src/modules/auth/entry.service");

describe("verifyEntry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findOne.mockResolvedValue(null);
    OTP.deleteMany.mockResolvedValue({ deletedCount: 1 });
  });

  it("uses the OTP document mobile when pending details predate that field", async () => {
    OTP.findOne.mockResolvedValue({
      mobile: "9876543210",
      otp: "123456",
      role: USER_ROLE.CUSTOMER,
      product: "personal",
      createdAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
      pendingDetails: {
        name: "Rahul Sharma",
        email: "rahul@example.com",
        dob: new Date("1995-05-15"),
        panNumber: "ABCDE1234F",
        continent: "Asia",
        country: "India",
      },
    });

    const result = await verifyEntry({
      mobile: "9876543210",
      otp: "123456",
      expectedRole: USER_ROLE.CUSTOMER,
    });

    expect(User).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Rahul Sharma",
        mobile: "9876543210",
        email: "rahul@example.com",
      })
    );
    expect(result.token).toBe("test-token");
    expect(result.nextStep).toBe("loan-apply");
    expect(OTP.deleteMany).not.toHaveBeenCalled();
  });

  it("allows the same OTP to be verified again without repeating account creation", async () => {
    const otpData = {
      mobile: "9876543210",
      otp: "123456",
      role: USER_ROLE.CUSTOMER,
      product: "personal",
      createdAt: new Date(),
      verifiedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
      pendingDetails: {
        name: "Rahul Sharma",
        email: "rahul@example.com",
        dob: new Date("1995-05-15"),
        panNumber: "ABCDE1234F",
      },
    };
    OTP.findOne.mockResolvedValue(otpData);

    const firstResult = await verifyEntry({
      mobile: "9876543210",
      otp: "123456",
      expectedRole: USER_ROLE.CUSTOMER,
    });
    const account = User.mock.instances[0];
    User.findOne.mockResolvedValue(account);

    const secondResult = await verifyEntry({
      mobile: "9876543210",
      otp: "123456",
      expectedRole: USER_ROLE.CUSTOMER,
    });

    expect(firstResult.customerId).toBe(secondResult.customerId);
    expect(secondResult.token).toBe("test-token");
    expect(User).toHaveBeenCalledTimes(1);
    expect(account.save).toHaveBeenCalledTimes(1);
    expect(otpData.save).toHaveBeenCalledTimes(1);
    expect(OTP.deleteMany).not.toHaveBeenCalled();
  });

  it("verifies the mobile without replacing an existing account email owned elsewhere", async () => {
    const account = {
      _id: "customer-account",
      name: "Rahul Sharma",
      mobile: "9876543210",
      email: "existing@example.com",
      customerId: "CUST000010",
      role: USER_ROLE.CUSTOMER,
      save: jest.fn().mockResolvedValue(undefined),
    };
    User.findOne
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce({ _id: "different-account", email: "rahul@example.com" });
    const otpData = {
      mobile: "9876543210",
      otp: "123456",
      role: USER_ROLE.CUSTOMER,
      product: "personal",
      createdAt: new Date(),
      verifiedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
      pendingDetails: {
        name: "Rahul Sharma",
        email: "rahul@example.com",
        dob: new Date("1995-05-15"),
        panNumber: "ABCDE1234F",
      },
    };
    OTP.findOne.mockResolvedValue(otpData);

    const result = await verifyEntry({
      mobile: "9876543210",
      otp: "123456",
      expectedRole: USER_ROLE.CUSTOMER,
      issueToken: false,
    });

    expect(account.email).toBe("existing@example.com");
    expect(account.isVerified).toBe(true);
    expect(account.save).toHaveBeenCalled();
    expect(result.user.email).toBe("existing@example.com");
  });

  it("accepts a matching OTP regardless of its age", async () => {
    const otpData = {
      mobile: "9876543210",
      otp: "123456",
      role: USER_ROLE.CUSTOMER,
      createdAt: new Date(Date.now() - 6 * 60 * 1000 - 1),
      verifiedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
      pendingDetails: {
        name: "Rahul Sharma",
        email: "rahul@example.com",
        dob: new Date("1995-05-15"),
        panNumber: "ABCDE1234F",
      },
    };
    OTP.findOne.mockResolvedValue(otpData);

    const result = await verifyEntry({
      mobile: "9876543210",
      otp: "123456",
      expectedRole: USER_ROLE.CUSTOMER,
    });

    expect(result.customerId).toBe("CUST000001");
    expect(User.mock.instances[0].save).toHaveBeenCalled();
    expect(otpData.save).toHaveBeenCalled();
    expect(OTP.deleteMany).not.toHaveBeenCalled();
  });
});
