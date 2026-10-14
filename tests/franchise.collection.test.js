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
jest.mock("../src/utils/generateToken", () => jest.fn(() => "test-token"));

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const User = require("../src/modules/auth/user.model");
const Franchise = require("../src/modules/franchise/franchise.model");
const franchiseService = require("../src/modules/franchise/franchise.service");
const adminFranchiseService = require("../src/modules/admin/franchise.service");
const { requireApprovedFranchise } = require("../src/middleware/franchise.middleware");
const { USER_ROLE } = require("../src/constants/roles");

/*
Test data generators — koi value fixed nahi, har run par nayi. Isse tests kisi ek
mobile/PAN par lock nahi hote, jaise real users ke values badalte rehte hain.
*/
const randomMobile = () =>
  `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;

/** Random valid-format PAN: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F). */
const randomPan = () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const pick = (source) => source[Math.floor(Math.random() * source.length)];
  const first = Array.from({ length: 5 }, () => pick(letters)).join("");
  return `${first}${String(Math.floor(1000 + Math.random() * 9000))}${pick(letters)}`;
};

/** Random FRN code, jaise approve hone par mint hota hai (e.g. FRN000125). */
const randomFranchiseCode = () =>
  `FRN${String(Math.floor(1 + Math.random() * 999999)).padStart(6, "0")}`;

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
    // Koi value fixed nahi — har run par naya naam, mobile aur PAN.
    const name = `Franchise ${Math.random().toString(36).slice(2, 8)}`;
    const mobile = randomMobile();
    const panNumber = randomPan();

    const franchise = {
      _id: new mongoose.Types.ObjectId(),
      name,
      mobile,
      role: USER_ROLE.FRANCHISE,
      panNumber,
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
    // Password = is franchise ka PAN (uppercase, bcrypt hash).
    expect(await bcrypt.compare(panNumber, franchise.password)).toBe(true);
    expect(franchise.save).toHaveBeenCalled();

    // Hash kabhi response me nahi jaata.
    expect(approved).not.toHaveProperty("password");
  });
});

describe("approval gate before any loan can be filed", () => {
  beforeEach(() => jest.clearAllMocks());

  /*
  Koi fixed id/franchiseId nahi. Har case ek nayi franchise represent karta hai
  (approve hone par FRN mint hota hai) — sirf approval status decide karta hai ki
  woh franchise aage (login / loan routes) badh sakti hai ya nahi.
  */
  it("403s while the franchise is Pending", async () => {
    const franchiseId = new mongoose.Types.ObjectId().toString();

    Franchise.findById.mockResolvedValue({
      _id: franchiseId,
      role: USER_ROLE.FRANCHISE,
      franchiseStatus: "Pending",
    });

    const result = await runGuard(requireApprovedFranchise, { id: franchiseId, role: USER_ROLE.FRANCHISE });

    expect(result.allowed).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.payload.message).toMatch(/not approved yet/i);
    expect(Franchise.findById).toHaveBeenCalledWith(franchiseId);
  });

  it("403s with the rejected message when the application was rejected", async () => {
    const franchiseId = new mongoose.Types.ObjectId().toString();

    Franchise.findById.mockResolvedValue({
      _id: franchiseId,
      role: USER_ROLE.FRANCHISE,
      franchiseStatus: "Rejected",
    });

    const result = await runGuard(requireApprovedFranchise, { id: franchiseId, role: USER_ROLE.FRANCHISE });

    expect(result.statusCode).toBe(403);
    expect(result.payload.message).toMatch(/rejected/i);
  });

  /*
  Koi bhi approved franchise — har run par naya id aur naya FRN — guard se aage
  nikal jaati hai aur req.franchise par load hoti hai (login / loan routes ke liye).
  */
  it.each([randomFranchiseCode(), randomFranchiseCode(), randomFranchiseCode()])(
    "lets an Approved franchise (%s) through and loads it onto req.franchise",
    async (franchiseCode) => {
      const franchiseId = new mongoose.Types.ObjectId().toString();

      Franchise.findById.mockResolvedValue({
        _id: franchiseId,
        role: USER_ROLE.FRANCHISE,
        franchiseId: franchiseCode,
        franchiseStatus: "Approved",
      });

      const result = await runGuard(requireApprovedFranchise, { id: franchiseId, role: USER_ROLE.FRANCHISE });

      expect(result.allowed).toBe(true);
      expect(Franchise.findById).toHaveBeenCalledWith(franchiseId);
      expect(result.req.franchise).toMatchObject({ franchiseId: franchiseCode });
    }
  );

  it("403s a legacy franchise document still sitting in the users collection", async () => {
    // Migration se pehle ka account: franchises collection me nahi milta.
    const legacyId = new mongoose.Types.ObjectId().toString();
    Franchise.findById.mockResolvedValue(null);

    const result = await runGuard(requireApprovedFranchise, { id: legacyId, role: USER_ROLE.FRANCHISE });

    expect(result.allowed).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.payload.message).toMatch(/not found/i);
  });
});
