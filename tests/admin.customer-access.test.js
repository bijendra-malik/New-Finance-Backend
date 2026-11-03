const Admin = require("../src/modules/admin/admin.model");
const adminUserService = require("../src/modules/admin/adminUser.service");
const customerRoutes = require("../src/modules/admin/customer.routes");
const franchiseRoutes = require("../src/modules/admin/franchise.routes");
const franchiseController = require("../src/modules/admin/franchise.controller");
const franchiseService = require("../src/modules/admin/franchise.service");
const requireSuperAdmin = require("../src/middleware/requireSuperAdmin.middleware");

describe("admin customer access", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates a customer-only admin without loan product assignments", async () => {
    jest.spyOn(Admin, "findOne").mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    });
    const createdAdmin = {
      _id: "admin-id",
      name: "Customer Admin",
      email: "customers@example.com",
      role: "Admin",
      loanAccess: [],
      moduleAccess: ["customers"],
      isActive: true,
      toObject() {
        return this;
      },
    };
    const create = jest.spyOn(Admin, "create").mockResolvedValue(createdAdmin);

    await adminUserService.createAdmin({
      loginId: "customeradmin",
      name: "Customer Admin",
      email: "customers@example.com",
      password: "pass1234",
      moduleAccess: ["customers"],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        loanAccess: [],
        moduleAccess: ["customers"],
      })
    );
  });

  it("restricts customer loan applications to Super Admins", async () => {
    const route = customerRoutes.stack.find(
      (layer) => layer.route?.path === "/:id/applications"
    );
    expect(route).toBeDefined();
    expect(route.route.stack[0].handle).toBe(requireSuperAdmin);

    jest.spyOn(Admin, "findById").mockReturnValue({
      select: jest.fn().mockResolvedValue({ role: "Admin", isActive: true }),
    });

    const req = { admin: { id: "admin-id" } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await requireSuperAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Only a super admin can access this resource",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows franchise module admins to view franchise details but keeps actions Super Admin-only", () => {
    const listRoute = franchiseRoutes.stack.find(
      (layer) => layer.route?.path === "/"
    );
    expect(listRoute).toBeDefined();
    expect(listRoute.route.stack[0].handle).not.toBe(requireSuperAdmin);

    const detailRoute = franchiseRoutes.stack.find(
      (layer) => layer.route?.path === "/:id"
    );
    expect(detailRoute).toBeDefined();
    expect(detailRoute.route.stack[0].handle).not.toBe(requireSuperAdmin);

    for (const path of ["/:id/approve", "/:id/reject", "/:id/reset-password", "/:id/loans"]) {
      const route = franchiseRoutes.stack.find((layer) => layer.route?.path === path);
      expect(route).toBeDefined();
      expect(route.route.stack[0].handle).toBe(requireSuperAdmin);
    }
  });

  it("does not include franchise credentials or loan counts in module-admin detail responses", async () => {
    const franchise = { _id: "franchise-id", name: "Test Franchise", panNumber: "ABCDE1234F" };
    jest.spyOn(franchiseService, "getFranchiseById").mockResolvedValue(franchise);
    const countLoans = jest.spyOn(franchiseService, "countFranchiseLoans");
    const buildCredentials = jest.spyOn(franchiseService, "buildCredentials");
    const res = { json: jest.fn() };
    const next = jest.fn();

    await franchiseController.getOne(
      { params: { id: franchise._id }, admin: { role: "Admin", moduleAccess: ["franchises"] } },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      franchise,
    });
    expect(countLoans).not.toHaveBeenCalled();
    expect(buildCredentials).not.toHaveBeenCalled();
  });
});
