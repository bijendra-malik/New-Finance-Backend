const jwt = require("jsonwebtoken");
const Admin = require("../src/modules/admin/admin.model");
const adminAuth = require("../src/middleware/adminAuth.middleware");
const User = require("../src/modules/auth/user.model");
const Franchise = require("../src/modules/franchise/franchise.model");
const BusinessLoan = require("../src/modules/loans/business-loan/businessLoan.model");
const { MODELS } = require("../src/modules/loans/shared/loanStatus");
const { getListHandler } = require("../src/modules/loans/shared/adminStatus.service");
const dashboardController = require("../src/modules/admin/dashboard.controller");
const adminUserService = require("../src/modules/admin/adminUser.service");
const {
  PRODUCT_ACCESS_SLUGS,
  hasProductAccess,
  visibleLoanFilter,
  requireLoanAccess,
} = require("../src/modules/admin/adminLoanAccess");

describe("admin loan access", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("maps every loan product to an explicit permission slug", () => {
    expect(Object.values(PRODUCT_ACCESS_SLUGS)).toHaveLength(18);
    expect(new Set(Object.values(PRODUCT_ACCESS_SLUGS)).size).toBe(18);
  });

  it("grants admins only assigned products and lets super admins access all products", () => {
    const admin = { role: "Admin", loanAccess: ["business-loan"] };

    expect(hasProductAccess(admin, "business")).toBe(true);
    expect(hasProductAccess(admin, "personal")).toBe(false);
    expect(hasProductAccess({ role: "Admin", loanAccess: [] }, "business")).toBe(false);
    expect(hasProductAccess({ role: "SuperAdmin", loanAccess: [] }, "personal")).toBe(true);
  });

  it("rejects unassigned product routes", () => {
    const middleware = requireLoanAccess("personal");
    const req = { admin: { role: "Admin", loanAccess: ["business-loan"] } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("shows every application of the assigned product, rejected ones included", async () => {
    /*
    Product access hi visibility ka rule hai. Status (Rejected) data ko chhupata
    nahi — warna admin ko apne hi product ki rejections aur unka count nahi milta.
    */
    const find = jest.spyOn(BusinessLoan, "find").mockReturnValue({
      sort: jest.fn().mockResolvedValue([]),
    });
    const handler = getListHandler("business-loans");
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await handler({ admin: { role: "Admin" } }, res, jest.fn());
    expect(find).toHaveBeenLastCalledWith({});

    await handler({ admin: { role: "SuperAdmin" } }, res, jest.fn());
    expect(find).toHaveBeenLastCalledWith({});
  });

  it("limits the dashboard to permitted products and counts their rejected applications", async () => {
    jest.spyOn(User, "countDocuments").mockResolvedValue(0);
    jest.spyOn(Franchise, "countDocuments").mockResolvedValue(0);
    Object.values(MODELS).forEach((Model) => {
      jest.spyOn(Model, "countDocuments").mockResolvedValue(0);
      jest.spyOn(Model, "aggregate").mockResolvedValue([]);
      jest.spyOn(Model, "find").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([]),
      });
    });

    // Status aggregate: ek rejected application. Amounts aggregate: koi amount nahi.
    BusinessLoan.aggregate
      .mockResolvedValueOnce([{ _id: "Rejected", count: 1 }])
      .mockResolvedValueOnce([{ requested: 500000, approved: 0 }]);

    const res = { json: jest.fn() };
    await dashboardController.stats(
      { admin: { role: "Admin", loanAccess: ["business-loan"] } },
      res,
      jest.fn()
    );

    const stats = res.json.mock.calls[0][0].stats;
    expect(stats.products.map((product) => product.resource)).toEqual(["business-loans"]);
    // Rejected rows product ke andar hi ginte hain — 0 par clamp nahi hota.
    expect(stats.products[0].Rejected).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.totalApplications).toBe(0);
    expect(BusinessLoan.countDocuments).toHaveBeenCalledWith({});
    expect(BusinessLoan.find).toHaveBeenCalledWith({});
    expect(MODELS.personal.countDocuments).not.toHaveBeenCalled();
  });

  it("loads the current role and loan permissions from the database for each token", async () => {
    process.env.JWT_SECRET = "test-secret";
    const token = jwt.sign(
      { id: "64f000000000000000000001", type: "admin", role: "SuperAdmin" },
      process.env.JWT_SECRET
    );
    const adminRecord = {
      _id: "64f000000000000000000001",
      email: "admin@example.com",
      role: "Admin",
      loanAccess: ["business-loan"],
      isActive: true,
    };
    jest.spyOn(Admin, "findById").mockReturnValue({
      select: jest.fn().mockResolvedValue(adminRecord),
    });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await adminAuth(req, res, next);

    expect(req.admin).toEqual({
      id: adminRecord._id,
      email: adminRecord.email,
      role: "Admin",
      loanAccess: ["business-loan"],
    });
    expect(next).toHaveBeenCalled();
  });

  it("removes implicit all-product access when a Super Admin is demoted", async () => {
    const adminRecord = {
      _id: "64f000000000000000000002",
      role: "SuperAdmin",
      loanAccess: "all",
      save: jest.fn().mockResolvedValue(undefined),
      toObject() {
        return { ...this };
      },
    };
    jest.spyOn(Admin, "findById").mockResolvedValue(adminRecord);
    jest.spyOn(Admin, "countDocuments").mockResolvedValue(1);

    const result = await adminUserService.updateAdmin(
      adminRecord._id,
      { role: "Admin" },
      "64f000000000000000000003"
    );

    expect(adminRecord.loanAccess).toEqual([]);
    expect(result.loanAccess).toEqual([]);
  });

  it("keeps an Admin's customer-application filter unchanged (status is not a visibility rule)", () => {
    const filter = { user: "customer-id" };
    expect(
      visibleLoanFilter({ role: "Admin", loanAccess: ["business-loan"] }, filter)
    ).toEqual(filter);
    expect(
      visibleLoanFilter({ role: "SuperAdmin", loanAccess: "all" }, filter)
    ).toEqual(filter);
  });
});
