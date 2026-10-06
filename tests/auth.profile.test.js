jest.mock("../src/modules/auth/user.model", () => ({
  findById: jest.fn(),
}));

const User = require("../src/modules/auth/user.model");
const authController = require("../src/modules/auth/auth.controller");

const runProfile = async (handler) => {
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

  await handler({ user: { id: "user-id" } }, response, next);

  return { response, next };
};

describe("role-specific auth profiles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns customer fields without franchise data and normalizes legacy role", async () => {
    User.findById.mockResolvedValue({
      toObject: () => ({
        _id: "user-id",
        name: "Rahul Sharma",
        role: "User",
        continent: "Asia",
        franchiseStatus: "None",
        franchiseId: "FRN000001",
        panNumber: "ABCDE1234F",
        state: "Maharashtra",
        city: "Mumbai",
        pincode: "400001",
        package: "Premium",
        businessDetails: { businessName: "Example" },
        franchiseAppliedAt: new Date(),
        franchiseApprovedAt: null,
        franchiseRejectedAt: null,
      }),
    });

    const { response, next } = await runProfile(authController.customerProfile);

    expect(next).not.toHaveBeenCalled();
    expect(response.payload.user).toEqual({
      _id: "user-id",
      name: "Rahul Sharma",
      role: "Customer",
      continent: "Asia",
    });
  });

  it("returns franchise-specific data from the franchise profile", async () => {
    const franchise = {
      _id: "user-id",
      name: "Amit",
      role: "Franchise",
      franchiseStatus: "Pending",
      franchiseId: "FRN000001",
      panNumber: "ABCDE1234F",
    };
    User.findById.mockResolvedValue({ toObject: () => franchise });

    const { response, next } = await runProfile(authController.franchiseProfile);

    expect(next).not.toHaveBeenCalled();
    expect(response.payload.user).toEqual(franchise);
  });
});
