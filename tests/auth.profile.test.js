jest.mock("../src/modules/auth/user.model", () => ({
  findById: jest.fn(),
}));
jest.mock("../src/modules/franchise/franchise.model", () => ({
  findById: jest.fn(),
}));

const User = require("../src/modules/auth/user.model");
const Franchise = require("../src/modules/franchise/franchise.model");
const authController = require("../src/modules/auth/auth.controller");

const runProfile = async (handler, user = { id: "user-id" }) => {
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

  await handler({ user }, response, next);

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

  it("reads a franchise profile from the franchises collection (not users)", async () => {
    const franchise = {
      _id: "user-id",
      name: "Amit",
      role: "Franchise",
      franchiseStatus: "Pending",
      franchiseId: undefined,
      panNumber: "",
      state: "",
      city: "",
      pincode: "",
      package: "",
      businessDetails: {},
      franchiseAppliedAt: null,
      franchiseApprovedAt: null,
      franchiseRejectedAt: null,
    };
    Franchise.findById.mockResolvedValue({ toObject: () => franchise });

    const { response, next } = await runProfile(authController.franchiseProfile);

    expect(next).not.toHaveBeenCalled();
    expect(Franchise.findById).toHaveBeenCalledWith("user-id");
    expect(User.findById).not.toHaveBeenCalled();
    expect(response.payload.user).toEqual({
      _id: "user-id",
      name: "Amit",
      role: "Franchise",
      franchiseStatus: "Pending",
    });
  });

  it("keeps submitted franchise application details in the profile", async () => {
    const franchise = {
      _id: "user-id",
      name: "Amit",
      role: "Franchise",
      franchiseStatus: "Pending",
      panNumber: "ABCDE1234F",
      state: "Maharashtra",
      city: "Mumbai",
      businessDetails: { businessName: "Amit Services" },
    };
    Franchise.findById.mockResolvedValue({ toObject: () => franchise });

    const { response } = await runProfile(authController.franchiseProfile);

    expect(response.payload.user).toEqual(franchise);
  });

  it("GET /api/auth/profile follows the token's role to the right collection", async () => {
    User.findById.mockResolvedValue({ _id: "user-id", role: "Customer" });

    const { response } = await runProfile(authController.profile, { id: "user-id", role: "Customer" });

    expect(User.findById).toHaveBeenCalledWith("user-id");
    expect(response.payload.user).toMatchObject({ role: "Customer" });

    Franchise.findById.mockResolvedValue({ _id: "frn-id", role: "Franchise" });

    await runProfile(authController.profile, { id: "frn-id", role: "Franchise" });

    expect(Franchise.findById).toHaveBeenCalledWith("frn-id");
  });
});
