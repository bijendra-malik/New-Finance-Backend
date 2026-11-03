const User = require("../src/modules/auth/user.model");
const Franchise = require("../src/modules/franchise/franchise.model");
const { MODELS } = require("../src/modules/loans/shared/loanStatus");
const dashboardController = require("../src/modules/admin/dashboard.controller");

describe("customer-only admin dashboard", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns customer dashboard data without loan application metrics", async () => {
    jest.spyOn(User, "countDocuments").mockResolvedValue(12);
    jest.spyOn(User, "find").mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([]),
    });
    const loanQueries = Object.values(MODELS).map((Model) =>
      jest.spyOn(Model, "countDocuments")
    );
    const req = {
      admin: {
        role: "Admin",
        moduleAccess: ["customers"],
        loanAccess: [],
      },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await dashboardController.stats(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        stats: expect.objectContaining({
          dashboardMode: "customers",
          totalCustomers: 12,
          activeCustomers: 12,
          inactiveCustomers: 12,
          verifiedCustomers: 12,
          recentCustomers: [],
        }),
      })
    );
    expect(res.json.mock.calls[0][0].stats).not.toHaveProperty("products");
    expect(res.json.mock.calls[0][0].stats).not.toHaveProperty("recent");
    expect(loanQueries.every((query) => query.mock.calls.length === 0)).toBe(true);
    expect(User.countDocuments).toHaveBeenCalledWith({
      role: { $ne: "Franchise" },
    });
  });

  it("returns franchise-only dashboard data without customer or loan metrics", async () => {
    jest.spyOn(Franchise, "countDocuments").mockResolvedValue(8);
    jest.spyOn(Franchise, "find").mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([]),
    });
    const customerCount = jest.spyOn(User, "countDocuments");
    const loanQueries = Object.values(MODELS).map((Model) =>
      jest.spyOn(Model, "countDocuments")
    );
    const req = {
      admin: {
        role: "Admin",
        moduleAccess: ["franchises"],
        loanAccess: [],
      },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await dashboardController.stats(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        stats: expect.objectContaining({
          dashboardMode: "franchises",
          totalFranchises: 8,
          pendingFranchises: 8,
          approvedFranchises: 8,
          rejectedFranchises: 8,
          registeredFranchises: 8,
          activeFranchises: 8,
          recentFranchises: [],
        }),
      })
    );
    expect(res.json.mock.calls[0][0].stats).not.toHaveProperty("products");
    expect(res.json.mock.calls[0][0].stats).not.toHaveProperty("recent");
    expect(customerCount).not.toHaveBeenCalled();
    expect(loanQueries.every((query) => query.mock.calls.length === 0)).toBe(true);
  });

  it("returns both account overviews only when both modules are assigned", async () => {
    jest.spyOn(User, "countDocuments").mockResolvedValue(12);
    jest.spyOn(User, "find").mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([]),
    });
    jest.spyOn(Franchise, "countDocuments").mockResolvedValue(8);
    jest.spyOn(Franchise, "find").mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([]),
    });
    const req = {
      admin: {
        role: "Admin",
        moduleAccess: ["customers", "franchises"],
        loanAccess: [],
      },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await dashboardController.stats(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        stats: expect.objectContaining({
          dashboardMode: "accounts",
          totalCustomers: 12,
          totalFranchises: 8,
          recentCustomers: [],
          recentFranchises: [],
        }),
      })
    );
  });

  it("does not expose account dashboard data to admins without a dashboard module", async () => {
    const userCount = jest.spyOn(User, "countDocuments");
    const franchiseCount = jest.spyOn(Franchise, "countDocuments");
    const req = { admin: { role: "Admin", moduleAccess: [], loanAccess: [] } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await dashboardController.stats(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(userCount).not.toHaveBeenCalled();
    expect(franchiseCount).not.toHaveBeenCalled();
  });
});
