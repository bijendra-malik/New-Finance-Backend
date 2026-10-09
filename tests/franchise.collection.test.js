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

  it("migrates a legacy franchise by the authenticated ID before applying", async () => {
    const franchiseObjectId = new mongoose.Types.ObjectId();
    const franchiseId = franchiseObjectId.toString();
    const legacy = {
      _id: franchiseObjectId,
      name: "Tanisha Vyas",
      mobile: randomMobile(),
      email: "tanisha@example.com",
      role: USER_ROLE.FRANCHISE,
      isVerified: true,
      continent: "Asia",
      country: "India",
      franchiseStatus: "None",
    };
    const migratedFranchise = {
      _id: franchiseObjectId,
      franchiseStatus: "None",
      save: jest.fn().mockResolvedValue(undefined),
    };

    Franchise.findById.mockResolvedValue(null);
    User.collection = {
      findOne: jest.fn().mockResolvedValue(legacy),
    };
    Franchise.create.mockResolvedValue(migratedFranchise);

    const result = await franchiseService.applyFranchise(franchiseId, {
      panNumber: randomPan(),
      state: "Uttar Pradesh",
      city: "Noida",
      package: "Premium",
    });

    expect(User.collection.findOne).toHaveBeenCalledWith({
      _id: franchiseObjectId,
      role: USER_ROLE.FRANCHISE,
    });
    expect(Franchise.create).toHaveBeenCalledWith(legacy);
    expect(result).toBe(migratedFranchise);
    expect(migratedFranchise.franchiseStatus).toBe("Pending");
    expect(migratedFranchise.save).toHaveBeenCalled();
  });

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

  /*
  Ye flow KISI BHI mobile ke liye generic hai — test kisi fixed number par lock
  nahi hai. Har run par naye random 10-digit numbers bante hain, aur register /
  login usi number par hota hai (jaise real user apne mobile number se karta hai).
  OTP hamesha STATIC_OTP = 123456 rehta hai (badalta nahi).
  */
  const ANY_MOBILES = [randomMobile(), randomMobile(), randomMobile()];

  describe("mobile-OTP flow is generic for any registered mobile (STATIC_OTP 123456)", () => {
    const PREVIOUS_STATIC_OTP = process.env.STATIC_OTP;

    beforeAll(() => {
      process.env.STATIC_OTP = "123456";
    });

    afterAll(() => {
      if (PREVIOUS_STATIC_OTP === undefined) delete process.env.STATIC_OTP;
      else process.env.STATIC_OTP = PREVIOUS_STATIC_OTP;
    });

    beforeEach(() => {
      jest.clearAllMocks();
      OTP.deleteMany.mockResolvedValue({});
      OTP.create.mockResolvedValue({});
    });

    it.each(ANY_MOBILES)(
      "login for %s ignores the legacy users doc and mails OTP 123456 to the franchise",
      async (mobile) => {
        // Migration se pehle ka leftover: `users` me role Franchise, isVerified false.
        // Pehle ye doc login ko "Account not verified" de deta tha.
        User.findOne.mockResolvedValue({
          _id: "stale-user-id",
          mobile,
          role: USER_ROLE.FRANCHISE,
          isVerified: false,
        });
        Franchise.findOne.mockResolvedValue({
          _id: "frn-id",
          mobile,
          role: USER_ROLE.FRANCHISE,
          franchiseId: "FRN000003",
          franchiseStatus: "Approved",
          isVerified: true,
        });

        const { response, next } = await runController(authController.login, { mobile });

        expect(next).not.toHaveBeenCalled();
        expect(response.payload.success).toBe(true);
        expect(Franchise.findOne).toHaveBeenCalledWith({ mobile });
        expect(OTP.create).toHaveBeenCalledWith(
          expect.objectContaining({ mobile, otp: "123456", role: USER_ROLE.FRANCHISE })
        );
        // Asli franchise pehle mil gayi — stale users doc chhua bhi nahi gaya.
        expect(User.findOne).not.toHaveBeenCalled();
      }
    );

    it.each(ANY_MOBILES)(
      "register for %s is not blocked by the legacy users doc and issues OTP 123456",
      async (mobile) => {
        // Legacy doc `users` me pada hai, par franchise registration use ignore
        // karti hai — isliye conflict filter ({ role: { $ne: "Franchise" } }) par null.
        User.findOne.mockImplementation((query) =>
          Promise.resolve(
            query?.role ? null : { _id: "stale-user-id", mobile, role: USER_ROLE.FRANCHISE, isVerified: false }
          )
        );
        Franchise.findOne.mockResolvedValue(null);
        Franchise.create.mockResolvedValue({});

        const { response, next } = await runController(authController.register, {
          role: USER_ROLE.FRANCHISE,
          continent: "Asia",
          country: "India",
          name: "Any Franchise",
          mobile,
          email: `fr.${mobile}@example.com`,
        });

        expect(next).not.toHaveBeenCalled();
        expect(response.payload.success).toBe(true);
        expect(OTP.create).toHaveBeenCalledWith(
          expect.objectContaining({ mobile, otp: "123456", role: USER_ROLE.FRANCHISE })
        );
      }
    );

    it.each(ANY_MOBILES)(
      "login for %s on an unverified account resends a verification OTP (no dead-end)",
      async (mobile) => {
        // Register ke baad verify adhoora (isVerified false) — login ab 400 nahi
        // deta, balki fresh OTP bhejkar needsVerification batata hai.
        Franchise.findOne.mockResolvedValue({
          _id: "frn-id",
          mobile,
          role: USER_ROLE.FRANCHISE,
          isVerified: false,
        });

        const { response, next } = await runController(authController.login, { mobile });

        expect(next).not.toHaveBeenCalled();
        expect(response.payload).toMatchObject({ success: true, needsVerification: true });
        expect(OTP.create).toHaveBeenCalledWith(
          expect.objectContaining({ mobile, otp: "123456", role: USER_ROLE.FRANCHISE })
        );
      }
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
