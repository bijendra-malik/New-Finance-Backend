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
  });
});
