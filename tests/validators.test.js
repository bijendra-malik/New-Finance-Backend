const { applyValidator } = require("../src/modules/loans/personal-loan/personalLoan.validator");
const { normalizeTransactionBankNames, sanitizeBusinessLoanResponse } = require("../src/modules/loans/business-loan/businessLoan.controller");
const homeLoanController = require("../src/modules/loans/home-loan/homeLoan.controller");
const personalLoanController = require("../src/modules/loans/personal-loan/personalLoan.controller");
const { normalizeApplyPayload } = require("../src/utils/normalizeLoanPayload");
const { appendUniqueValue } = require("../src/modules/masters/master.service");
const PersonalLoan = require("../src/modules/loans/personal-loan/personalLoan.model");
const LoanAgainstProperty = require("../src/modules/loans/loan-against-property/loanAgainstProperty.model");
const LoanAgainstPropertyController = require("../src/modules/loans/loan-against-property/loanAgainstProperty.controller");
const FdiLoan = require("../src/modules/loans/fdi-loan/fdiLoan.model");
const { applyValidator: fdiLoanApplyValidator } = require("../src/modules/loans/fdi-loan/fdiLoan.validator");
const BusinessLoan = require("../src/modules/loans/business-loan/businessLoan.model");
const HomeLoan = require("../src/modules/loans/home-loan/homeLoan.model");
const { businessIncomeFields } = require("../src/modules/loans/shared/loanSchema");
const { getListHandler } = require("../src/modules/loans/shared/adminStatus.service");
const listBusinessLoans = getListHandler("business-loans");
const listLoanAgainstProperties = getListHandler("loan-against-properties");
const listFdiLoans = getListHandler("fdi-loans");
const BalanceTransfer = require("../src/modules/loans/balance-transfer/balanceTransfer.model");
const { applyValidator: balanceTransferApplyValidator } = require("../src/modules/loans/balance-transfer/balanceTransfer.validator");
const ProjectLoan = require("../src/modules/loans/project-loan/projectLoan.model");
const { applyValidator: projectLoanApplyValidator } = require("../src/modules/loans/project-loan/projectLoan.validator");
const VehicleLoan = require("../src/modules/loans/vehicle-loan/vehicleLoan.model");
const { applyValidator: vehicleLoanApplyValidator } = require("../src/modules/loans/vehicle-loan/vehicleLoan.validator");
const EducationLoan = require("../src/modules/loans/education-loan/educationLoan.model");
const { applyValidator: educationLoanApplyValidator } = require("../src/modules/loans/education-loan/educationLoan.validator");
const CreditCard = require("../src/modules/loans/credit-card/creditCard.model");
const { applyValidator: creditCardApplyValidator } = require("../src/modules/loans/credit-card/creditCard.validator");

jest.mock("../src/modules/loans/business-loan/businessLoan.model", () => ({
  find: jest.fn(),
  findById: jest.fn(),
}));

/*
The apply handlers read the verified account (entry details check) and mint an
application number before saving. Both are DB-backed, so they are mocked here —
otherwise Mongoose buffers the query and every controller test times out.
*/
jest.mock("../src/modules/auth/user.model", () => ({ findById: jest.fn() }));
jest.mock("../src/utils/sequence", () => ({ nextLoanApplicationNo: jest.fn() }));

const User = require("../src/modules/auth/user.model");
const { nextLoanApplicationNo } = require("../src/utils/sequence");

/* Every direct-apply test uses the same verified identity (see the payloads). */
const verifiedAccount = {
  name: "Rohit Sharma",
  mobile: "9876543210",
  email: "rohit@example.com",
  dob: "1992-06-15",
  panNumber: "ABCDE1234F",
  // Apply ab credit-score gate ke peeche hai (600+ aur 24-hour window).
  creditScore: 720,
  creditScoreCheckedAt: new Date(),
  creditEligible: true,
  creditEligibilityExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
};

beforeEach(() => {
  User.findById.mockResolvedValue(verifiedAccount);
  nextLoanApplicationNo.mockResolvedValue("LOAN000001");
  jest.spyOn(HomeLoan, "exists").mockResolvedValue(null);
  jest.spyOn(PersonalLoan, "exists").mockResolvedValue(null);
  jest.spyOn(LoanAgainstProperty, "exists").mockResolvedValue(null);
});

/** Runs an express-validator chain (+ the trailing handleValidationErrors) against a fake req. */
const runChain = (chain, body) => {
  const req = { body };
  return new Promise((resolve) => {
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ passed: false, statusCode: this.statusCode, body: payload });
        return this;
      },
    };

    let idx = 0;
    const next = async () => {
      if (idx >= chain.length) {
        resolve({ passed: true });
        return;
      }
      await chain[idx++](req, res, next);
    };
    next();
  });
};


describe("personalLoanValidators.applyValidator", () => {
  const validPayload = {
    loanAmount: 500000,
    loanTenure: 2,
    fullName: "Test User",
    mobile: "9876543210",
  };

  it("passes with the minimum required fields", async () => {
    const result = await runChain(applyValidator, validPayload);
    expect(result.passed).toBe(true);
  });

  it("rejects a client-supplied status field (mass-assignment guard)", async () => {
    const result = await runChain(applyValidator, { ...validPayload, status: "Approved" });
    expect(result.passed).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it("rejects a non-numeric loan amount", async () => {
    const result = await runChain(applyValidator, { ...validPayload, loanAmount: "abc" });
    expect(result.passed).toBe(false);
  });

  it("rejects a mobile number that starts with zero", async () => {
    const result = await runChain(applyValidator, { ...validPayload, mobile: "0876543210" });
    expect(result.passed).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe("homeLoanModel.professionalPayload", () => {
  it("does not require business-only fields for professional employment type", () => {
    const doc = new HomeLoan({
      user: "64f000000000000000000001",
      loanType: "Home Loan",
      loanAmount: 1000000,
      loanTenure: 5,
      buyingPropertyType: "Apartment",
      buyingPropertyAge: 3,
      buyingPropertyState: "Maharashtra",
      buyingPropertyCity: "Mumbai",
      buyingPropertyPincode: "400001",
      employmentType: "Self Employed - Professional",
      profession: "Doctor",
      currentYearTurnover: 500000,
      priorYearTurnover: 450000,
      currentYearNetIncome: 70000,
      previousYearNetIncome: 65000,
      businessState: "Maharashtra",
      businessCity: "Mumbai",
      businessPincode: "400001",
      businessPlaceStatus: "Owned",
      transactionBankName: { displayName: "HDFC", banks: ["HDFC"] },
      fullName: "Bijendra99",
      mobile: "8691889999",
      email: "vinimalik99@gmail.com",
      dob: "1995-05-15",
      panNumber: "ABCDE1234F",
      state: "Maharashtra",
      city: "Mumbai",
      pincode: "400001",
      residenceStatus: "Owned",
    });

    const error = doc.validateSync();
    expect(error).toBeUndefined();
  });

  it("does not require business-only fields for salaried employment type", () => {
    const doc = new HomeLoan({
      user: "64f000000000000000000001",
      loanType: "Home Loan",
      loanAmount: 1000000,
      loanTenure: 5,
      buyingPropertyType: "Apartment",
      buyingPropertyAge: 3,
      buyingPropertyState: "Maharashtra",
      buyingPropertyCity: "Mumbai",
      buyingPropertyPincode: "400001",
      employmentType: "Salaried",
      companyName: "ABC Corp",
      companyType: "Private Limited",
      monthlySalary: 75000,
      salaryReceivedAs: "Bank Transfer",
      salaryBankName: "HDFC",
      fullName: "John Doe",
      mobile: "9876543210",
      email: "john@example.com",
      dob: "1995-05-15",
      panNumber: "ABCDE1234F",
      state: "Maharashtra",
      city: "Mumbai",
      pincode: "400001",
      residenceStatus: "Owned",
    });

    const error = doc.validateSync();
    expect(error).toBeUndefined();
  });

  it("keeps business address requirements scoped to both self-employed employment types", () => {
    expect(businessIncomeFields.businessState.required.call({ employmentType: "Salaried" })).toBe(false);
    expect(businessIncomeFields.businessState.required.call({ employmentType: "Self Employed - Business" })).toBe(true);
    expect(businessIncomeFields.businessState.required.call({ employmentType: "Self Employed - Professional" })).toBe(true);
    expect(businessIncomeFields.businessPincode.required.call({ employmentType: "Salaried" })).toBe(false);
    expect(businessIncomeFields.businessPincode.required.call({ employmentType: "Self Employed - Business" })).toBe(true);
    expect(businessIncomeFields.businessPincode.required.call({ employmentType: "Self Employed - Professional" })).toBe(true);
  });
});

describe("businessLoanController.normalizeTransactionBankNames", () => {
  it("keeps selected banks and appends a custom other bank name", () => {
    const result = normalizeTransactionBankNames(["HDFC", "SBI"], "Yes Bank");
    expect(result).toEqual({
      displayName: "Multiple Transaction Banks",
      banks: ["HDFC", "SBI", "Yes Bank"],
    });
  });

  it("removes sentinel values and keeps only actual bank names", () => {
    const result = normalizeTransactionBankNames(["HDFC", "Multiple Transaction Banks"], "Yes Bank");
    expect(result).toEqual({
      displayName: "Multiple Transaction Banks",
      banks: ["HDFC", "Yes Bank"],
    });
  });
});

describe("businessLoanController.sanitizeBusinessLoanResponse", () => {
  it("removes professional-only fields for a business employment type", () => {
    const result = sanitizeBusinessLoanResponse({
      employmentType: "Self Employed - Business",
      currentYearTurnover: 0,
      priorYearTurnover: 0,
      currentYearNetIncome: 0,
      previousYearNetIncome: 0,
      lastYearTurnover: 2500000,
      lastYearNetIncome: 350000,
      transactionBankName: ["HDFC"],
    });

    expect(result).not.toHaveProperty("currentYearTurnover");
    expect(result).not.toHaveProperty("priorYearTurnover");
    expect(result).not.toHaveProperty("currentYearNetIncome");
    expect(result).not.toHaveProperty("previousYearNetIncome");
    expect(result).toHaveProperty("lastYearTurnover", 2500000);
    expect(result).toHaveProperty("transactionBankName");
    expect(result.transactionBankName).toEqual({
      displayName: "HDFC",
      banks: ["HDFC"],
    });
  });

  it("removes business-only fields for a professional employment type", () => {
    const result = sanitizeBusinessLoanResponse({
      employmentType: "Self Employed - Professional",
      profession: "Doctor",
      currentYearTurnover: 500000,
      priorYearTurnover: 450000,
      currentYearNetIncome: 70000,
      previousYearNetIncome: 65000,
      businessType: "Proprietorship",
      businessName: "ABC Pvt Ltd",
      lastYearTurnover: 2500000,
      lastYearNetIncome: 350000,
    });

    expect(result).not.toHaveProperty("businessType");
    expect(result).not.toHaveProperty("businessName");
    expect(result).not.toHaveProperty("lastYearTurnover");
    expect(result).not.toHaveProperty("lastYearNetIncome");
    expect(result).toHaveProperty("profession", "Doctor");
    expect(result).toHaveProperty("currentYearTurnover", 500000);
  });
});

/*
The admin list handlers return the contract payload `{ success, loans }`
with the raw admin-side documents (sanitized section views remain on the
user-facing endpoints), so the assertions below target `payload.loans`.
*/
describe("adminApplicationController.listBusinessLoans", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns business loan records under the `loans` key", async () => {
    BusinessLoan.find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([
        {
          employmentType: "Self Employed - Business",
          currentYearTurnover: 0,
          priorYearTurnover: 0,
          currentYearNetIncome: 0,
          previousYearNetIncome: 0,
          lastYearTurnover: 2500000,
          lastYearNetIncome: 350000,
          transactionBankName: ["HDFC"],
        },
      ]),
    });

    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await listBusinessLoans(req, res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.loans)).toBe(true);
    expect(payload.loans[0]).toHaveProperty("lastYearTurnover", 2500000);
    expect(payload.loans[0]).toHaveProperty("transactionBankName");
  });
});

describe("masterService.appendUniqueValue", () => {
  it("adds a custom value without duplicating case-insensitive matches", () => {
    const values = ["HDFC Bank", "SBI"];
    const result = appendUniqueValue(values, "hdfc bank");
    expect(result).toEqual(["HDFC Bank", "SBI"]);
  });

  it("appends a new value when it is unique", () => {
    const values = ["HDFC Bank", "SBI"];
    const result = appendUniqueValue(values, "Axis Bank");
    expect(result).toEqual(["HDFC Bank", "SBI", "Axis Bank"]);
  });
});

describe("homeLoanController.apply (Self Employed - Business)", () => {
  const businessPayload = {
    loanAmount: 1800000,
    loanTenure: 15,
    buyingPropertyType: "Villa",
    buyingPropertyAge: 5,
    buyingPropertyState: "Maharashtra",
    buyingPropertyCity: "Pune",
    buyingPropertyPincode: "411001",
    employmentType: "Self Employed - Business",
    businessType: "Proprietorship",
    businessName: "Aarav Traders",
    companyPanNumber: "ABCDE1234F",
    natureOfBusiness: "Retail",
    industryType: "Trading",
    businessEstablishedDate: "2018-05-12",
    transactionBankName: { displayName: "Multiple Transaction Banks", banks: ["HDFC", "SBI", "ICICI"] },
    lastYearTurnover: 2500000,
    last2YearsTurnover: 2300000,
    lastYearNetIncome: 350000,
    last2YearsNetIncome: 300000,
    businessState: "Maharashtra",
    businessCity: "Pune",
    businessPincode: "411001",
    businessPlaceStatus: "Owned",
    fullName: "Rohit Sharma",
    mobile: "9876543210",
    email: "rohit@example.com",
    dob: "1992-06-15",
    panNumber: "ABCDE1234F",
    state: "Maharashtra",
    city: "Pune",
    pincode: "411001",
    residenceStatus: "Owned",
  };

  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps business address fields when creating a business home-loan application", async () => {
    const createSpy = jest.spyOn(HomeLoan, "create").mockResolvedValue({ toObject: () => ({ ...businessPayload }) });

    await homeLoanController.apply({ body: businessPayload, user: { id: "64f000000000000000000001" } }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const saved = createSpy.mock.calls[0][0];
    expect(saved.businessState).toBe("Maharashtra");
    expect(saved.businessCity).toBe("Pune");
    expect(saved.businessPincode).toBe("411001");
    expect(saved.businessPlaceStatus).toBe("Owned");
    expect(saved.currentYearTurnover).toBeUndefined();
    expect(saved.transactionBankName).toEqual({
      displayName: "Multiple Transaction Banks",
      banks: ["HDFC", "SBI", "ICICI"],
    });
  });

  it("strips professional-only fields from the business response", async () => {
    jest.spyOn(HomeLoan, "create").mockResolvedValue({
      toObject: () => ({
        ...businessPayload,
        profession: "Doctor",
        currentYearTurnover: 100,
        priorYearTurnover: 90,
        currentYearNetIncome: 10,
        previousYearNetIncome: 9,
      }),
    });

    await homeLoanController.apply({ body: businessPayload, user: { id: "64f000000000000000000001" } }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toHaveProperty("profession");
    expect(res.body.data).not.toHaveProperty("currentYearTurnover");
    expect(res.body.data).toHaveProperty("businessState", "Maharashtra");
  });
});

describe("homeLoanValidators.applyValidator (Self Employed - Business)", () => {
  const { applyValidator: homeApplyValidator } = require("../src/modules/loans/home-loan/homeLoan.validator");

  const businessPayload = {
    loanAmount: 1800000,
    loanTenure: 15,
    buyingPropertyType: "Villa",
    buyingPropertyAge: 5,
    buyingPropertyState: "Maharashtra",
    buyingPropertyCity: "Pune",
    buyingPropertyPincode: "411001",
    employmentType: "Self Employed - Business",
    businessType: "Proprietorship",
    businessName: "Aarav Traders",
    companyPanNumber: "ABCDE1234F",
    natureOfBusiness: "Retail",
    industryType: "Trading",
    businessEstablishedDate: "2018-05-12",
    transactionBankName: { displayName: "Multiple Transaction Banks", banks: ["HDFC", "SBI", "ICICI"] },
    lastYearTurnover: 2500000,
    lastYearNetIncome: 350000,
    businessState: "Maharashtra",
    businessCity: "Pune",
    businessPincode: "411001",
    businessPlaceStatus: "Owned",
    fullName: "Rohit Sharma",
    mobile: "9876543210",
    email: "rohit@example.com",
    dob: "1992-06-15",
    panNumber: "ABCDE1234F",
    state: "Maharashtra",
    city: "Pune",
    pincode: "411001",
    residenceStatus: "Owned",
  };

  it("passes the full business payload", async () => {
    const result = await runChain(homeApplyValidator, businessPayload);
    expect(result.passed).toBe(true);
  });

  it("rejects an invalid company PAN number", async () => {
    const result = await runChain(homeApplyValidator, { ...businessPayload, companyPanNumber: "invalid" });
    expect(result.passed).toBe(false);
  });
});

/** Payload exactly as the deployed dashboard builds it (business/home quick forms). */
const dashboardBusinessPayload = (overrides = {}) => normalizeApplyPayload({
  loanAmount: 1000000,
  loanTenureYears: 15,
  employmentType: "Self Employed - Business",
  businessType: "Proprietorship",
  businessName: "Aarav Traders",
  companyPanNumber: "ABCDE1234F",
  natureOfBusiness: "Retail",
  industryType: "Trading",
  businessEstablishedDate: "2018-05-12T00:00:00.000Z",
  transactionBankName: "Multiple Transaction Banks",
  transactionBanks: ["HDFC", "SBI"],
  lastYearTurnover: 2500000,
  lastYearNetIncome: 350000,
  businessState: "Maharashtra",
  businessCity: "Pune",
  businessPincode: "411001",
  businessPlaceStatus: "Owned",
  fullName: "Rohit Sharma",
  mobile: "9876543210",
  email: "rohit@example.com",
  dob: "1992-06-15",
  panNumber: "ABCDE1234F",
  state: "Maharashtra",
  city: "Pune",
  pincode: "411001",
  residenceStatus: "Owned",
  ...overrides,
});

describe("normalizeLoanPayload.normalizeApplyPayload", () => {
  it("maps dashboard field names onto the canonical ones", () => {
    const payload = normalizeApplyPayload({
      monthlyNetSalary: 75000,
      salaryBankName: "HDFC Bank",
      existingBanks: ["HDFC"],
      existingBanksOther: ["Yes Bank"],
      existingLoanTypes: ["Personal Loan"],
      existingLoanTypesOther: [],
    });

    expect(payload.monthlySalary).toBe(75000);
    expect(payload.monthlyNetSalary).toBeUndefined();
    expect(payload.otherBankList).toEqual(["Yes Bank"]);
    expect(payload.existingBanksOther).toBeUndefined();
  });

  it("resolves '<field>: Other' into its free-text value", () => {
    const payload = normalizeApplyPayload({
      companyType: "Other",
      companyTypeOther: "Partnership",
      businessPlaceStatus: "Other",
      businessPlaceStatusOther: "Rented",
    });

    expect(payload.companyType).toBe("Partnership");
    expect(payload.companyTypeOther).toBeUndefined();
    expect(payload.businessPlaceStatus).toBe("Rented");
  });

  it("stores dashboard tenure as years ('-1' selects the custom value)", () => {
    expect(normalizeApplyPayload({ loanTenureYears: 15 }).loanTenure).toBe(15);
    // The browser sends both values as strings (select value + free text).
    expect(normalizeApplyPayload({ loanTenureYears: "-1", loanTenureYearsCustom: "20" }).loanTenure).toBe(20);
  });

  it("merges transactionBanks into transactionBankName", () => {
    const payload = normalizeApplyPayload({
      transactionBankName: "Multiple Transaction Banks",
      transactionBanks: ["HDFC", "SBI"],
      transactionBankNameOther: "",
    });

    expect(payload.transactionBankName).toEqual(["HDFC", "SBI"]);
    expect(payload.transactionBanks).toBeUndefined();
    expect(payload.transactionBankOther).toBeFalsy();
  });

  it("drops server-owned fields and flattens the data wrapper", () => {
    const payload = normalizeApplyPayload({
      data: { monthlyNetSalary: 1000, status: "Approved", createdAt: "2026-01-01", user: "someone-else" },
    });

    expect(payload.monthlySalary).toBe(1000);
    expect(payload.status).toBeUndefined();
    expect(payload.createdAt).toBeUndefined();
    expect(payload.user).toBeUndefined();
  });
});

describe("applyValidator (dashboard quick-form payloads)", () => {
  const { applyValidator: homeApplyValidator } = require("../src/modules/loans/home-loan/homeLoan.validator");
  const { applyValidator: businessApplyValidator } = require("../src/modules/loans/business-loan/businessLoan.validator");

  it("home loan: accepts a business payload without buying-property fields", async () => {
    const result = await runChain(homeApplyValidator, dashboardBusinessPayload());
    expect(result.passed).toBe(true);
  });

  it("business loan: accepts the same dashboard payload", async () => {
    const result = await runChain(businessApplyValidator, dashboardBusinessPayload());
    expect(result.passed).toBe(true);
  });
});

describe("homeLoanController.apply (dashboard quick form)", () => {
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("saves the dashboard payload and forces the authenticated user", async () => {
    const createSpy = jest.spyOn(HomeLoan, "create").mockResolvedValue({
      toObject: () => ({ employmentType: "Self Employed - Business", businessState: "Maharashtra" }),
    });

    const payload = dashboardBusinessPayload({
      status: "Pending",
      loanType: "Vehicle Loan",
      user: "some-other-user",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await homeLoanController.apply({ body: payload, user: { id: "64f000000000000000000001" } }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    const saved = createSpy.mock.calls[0][0];
    expect(saved.loanTenure).toBe(15);
    expect(saved.user).toBe("64f000000000000000000001");
    expect(saved.loanType).toBe("Home Loan");
    expect(saved.status).toBeUndefined();
    expect(saved.transactionBankName).toEqual({ displayName: "Multiple Transaction Banks", banks: ["HDFC", "SBI"] });
  });
});

describe("personalLoanController.apply (dashboard contract)", () => {
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts dashboard aliases and forces the authenticated user", async () => {
    const createSpy = jest.spyOn(PersonalLoan, "create").mockResolvedValue({ _id: "p1" });

    const payload = normalizeApplyPayload({
      fullName: "Rohit Sharma",
      mobile: "9876543210",
      employmentType: "Salaried",
      companyName: "ABC Corp",
      companyType: "Private Limited",
      monthlyNetSalary: 75000,
      salaryReceivedAs: "Bank Transfer",
      salaryBankName: "HDFC Bank",
      loanAmount: 500000,
      loanTenure: 5,
      existingBanks: ["HDFC"],
      existingBanksOther: ["Yes Bank"],
      existingLoanTypes: ["Personal Loan"],
      existingLoanTypesOther: [],
      status: "Approved",
    });

    await personalLoanController.apply({ body: payload, user: { id: "64f000000000000000000001" } }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    const saved = createSpy.mock.calls[0][0];
    expect(saved.monthlySalary).toBe(75000);
    expect(saved.otherBankList).toEqual(["Yes Bank"]);
    expect(saved.user).toBe("64f000000000000000000001");
    expect(saved.loanType).toBe("Personal Loan");
    expect(saved.status).toBeUndefined();

    // Per-application credit snapshot, copied from the account at submit time.
    expect(saved.creditScore).toBe(720);
    expect(saved.creditEligible).toBe(true);
    expect(saved.creditScoreCheckedAt).toEqual(verifiedAccount.creditScoreCheckedAt);
    expect(saved.creditEligibilityExpiresAt).toEqual(verifiedAccount.creditEligibilityExpiresAt);
  });

  it("ignores a client-supplied credit score and keeps the account snapshot", async () => {
    const createSpy = jest.spyOn(PersonalLoan, "create").mockResolvedValue({ _id: "p2" });

    const payload = normalizeApplyPayload({
      fullName: "Rohit Sharma",
      mobile: "9876543210",
      employmentType: "Salaried",
      companyName: "ABC Corp",
      companyType: "Private Limited",
      monthlyNetSalary: 75000,
      salaryReceivedAs: "Bank Transfer",
      salaryBankName: "HDFC Bank",
      loanAmount: 300000,
      loanTenure: 3,
      creditScore: 900,
      creditEligible: true,
      creditScoreCheckedAt: "2020-01-01T00:00:00.000Z",
    });

    await personalLoanController.apply({ body: payload, user: { id: "64f000000000000000000001" } }, res, jest.fn());

    const saved = createSpy.mock.calls[0][0];
    expect(saved.creditScore).toBe(720);
    expect(saved.creditEligible).toBe(true);
    expect(saved.creditScoreCheckedAt).toEqual(verifiedAccount.creditScoreCheckedAt);
  });
});

describe("salaried salary-bank rules (dashboard Cash case)", () => {
  const { applyValidator: homeApplyValidator } = require("../src/modules/loans/home-loan/homeLoan.validator");
  const { salaryBankName } = require("../src/modules/loans/shared/loanSchema").employmentIncomeFields;

  const salariedPayload = (overrides = {}) => ({
    loanAmount: 1500000,
    loanTenure: 4,
    employmentType: "Salaried",
    companyName: "Cash Co",
    companyType: "Partnership",
    monthlySalary: 40000,
    salaryReceivedAs: "Cash",
    fullName: "Rohit Sharma",
    mobile: "9876543210",
    email: "rohit@example.com",
    dob: "1992-06-15",
    panNumber: "ABCDE1234F",
    state: "Maharashtra",
    city: "Pune",
    pincode: "411001",
    residenceStatus: "Owned",
    ...overrides,
  });

  it("does not require a salary bank name when the salary is received as cash", async () => {
    const result = await runChain(homeApplyValidator, salariedPayload());
    expect(result.passed).toBe(true);
    expect(salaryBankName.required.call({ employmentType: "Salaried", salaryReceivedAs: "Cash" })).toBe(false);
  });

  it("still requires a salary bank name for non-cash salaries", async () => {
    const result = await runChain(homeApplyValidator, salariedPayload({ salaryReceivedAs: "Bank Transfer" }));
    expect(result.passed).toBe(false);
    expect(salaryBankName.required.call({ employmentType: "Salaried", salaryReceivedAs: "Bank Transfer" })).toBe(true);
  });
});

const lapPayload = (overrides = {}) => ({
  loanAmount: 2500000,
  loanTenure: 10,
  collateralPropertyType: "Residential",
  collateralPropertyMarketValue: 6000000,
  collateralPropertyAge: 7,
  collateralPropertyState: "Maharashtra",
  collateralPropertyCity: "Pune",
  collateralPropertyPincode: "411001",
  existingEMI: 0,
  existingLoanAmount: 0,
  employmentType: "Self Employed - Business",
  businessType: "Proprietorship",
  businessName: "Aarav Traders",
  companyPanNumber: "ABCDE1234F",
  natureOfBusiness: "Retail",
  industryType: "Trading",
  businessEstablishedDate: "2018-05-12",
  transactionBankName: { displayName: "Multiple Transaction Banks", banks: ["HDFC", "SBI"] },
  lastYearTurnover: 2500000,
  last2YearsTurnover: 2300000,
  lastYearNetIncome: 350000,
  last2YearsNetIncome: 300000,
  businessState: "Maharashtra",
  businessCity: "Pune",
  businessPincode: "411001",
  businessPlaceStatus: "Owned",
  fullName: "Rohit Sharma",
  mobile: "9876543210",
  email: "rohit@example.com",
  dob: "1992-06-15",
  panNumber: "ABCDE1234F",
  state: "Maharashtra",
  city: "Pune",
  pincode: "411001",
  residenceStatus: "Owned",
  ...overrides,
});

describe("loanAgainstPropertyValidators.applyValidator", () => {
  const { applyValidator: lapApplyValidator } = require("../src/modules/loans/loan-against-property/loanAgainstProperty.validator");

  it("passes a complete self-employed business payload", async () => {
    const result = await runChain(lapApplyValidator, lapPayload());
    expect(result.passed).toBe(true);
  });

  it("rejects a payload without collateral property details", async () => {
    const result = await runChain(lapApplyValidator, lapPayload({ collateralPropertyType: "" }));
    expect(result.passed).toBe(false);
  });

  it("rejects an applicant younger than 21", async () => {
    const under21Dob = new Date();
    under21Dob.setFullYear(under21Dob.getFullYear() - 20);
    const result = await runChain(
      lapApplyValidator,
      lapPayload({ dob: under21Dob.toISOString().slice(0, 10) })
    );
    expect(result.passed).toBe(false);
  });

  it("accepts an applicant who has reached 21", async () => {
    const age21Dob = new Date();
    age21Dob.setFullYear(age21Dob.getFullYear() - 21);
    const result = await runChain(
      lapApplyValidator,
      lapPayload({ dob: age21Dob.toISOString().slice(0, 10) })
    );
    expect(result.passed).toBe(true);
  });
});

describe("loanAgainstPropertyModel", () => {
  it("validates a complete business application", () => {
    const doc = new LoanAgainstProperty({ user: "64f000000000000000000001", ...lapPayload() });
    expect(doc.validateSync()).toBeUndefined();
  });

  it("requires collateral property details", () => {
    const doc = new LoanAgainstProperty({
      user: "64f000000000000000000001",
      loanAmount: 2500000,
      loanTenure: 10,
      employmentType: "Self Employed - Business",
      fullName: "Rohit Sharma",
      mobile: "9876543210",
      email: "rohit@example.com",
      dob: "1992-06-15",
      panNumber: "ABCDE1234F",
      state: "Maharashtra",
      city: "Pune",
      pincode: "411001",
      residenceStatus: "Owned",
    });

    const error = doc.validateSync();
    expect(error).toBeDefined();
    expect(Object.keys(error.errors)).toContain("collateralPropertyType");
  });
});

describe("loanAgainstPropertyController.apply", () => {
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps collateral + business fields and forces the authenticated user", async () => {
    const createSpy = jest.spyOn(LoanAgainstProperty, "create").mockResolvedValue({
      toObject: () => ({ employmentType: "Self Employed - Business", collateralPropertyState: "Maharashtra" }),
    });

    await LoanAgainstPropertyController.apply(
      { body: lapPayload({ status: "Pending", loanType: "Vehicle Loan", user: "someone-else" }), user: { id: "64f000000000000000000001" } },
      res,
      jest.fn()
    );

    expect(res.statusCode).toBe(201);
    const saved = createSpy.mock.calls[0][0];
    expect(saved.user).toBe("64f000000000000000000001");
    expect(saved.loanType).toBe("Loan Against Property");
    expect(saved.status).toBeUndefined();
    expect(saved.collateralPropertyState).toBe("Maharashtra");
    expect(saved.collateralPropertyMarketValue).toBe(6000000);
    expect(saved.businessState).toBe("Maharashtra");
    expect(saved.profession).toBeUndefined();
    expect(saved.transactionBankName).toEqual({
      displayName: "Multiple Transaction Banks",
      banks: ["HDFC", "SBI"],
    });
  });
});

describe("adminApplicationController.listLoanAgainstProperties", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns LAP records under the `loans` key", async () => {
    jest.spyOn(LoanAgainstProperty, "find").mockReturnValue({
      sort: jest.fn().mockResolvedValue([
        {
          employmentType: "Self Employed - Business",
          collateralPropertyState: "Maharashtra",
          profession: "Doctor",
          currentYearTurnover: 0,
          lastYearTurnover: 2500000,
        },
      ]),
    });

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await listLoanAgainstProperties({}, res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.loans)).toBe(true);
    expect(payload.loans[0].collateralPropertyState).toBe("Maharashtra");
    expect(payload.loans[0]).toHaveProperty("profession", "Doctor");
    expect(payload.loans[0]).toHaveProperty("lastYearTurnover", 2500000);
  });
});

describe("fdiLoan (FDI Fund Requirements)", () => {
  const fdiLoanPayload = (overrides = {}) =>
    lapPayload({
      loanAmount: 1000000000,
      loanTenure: 10,
      collateralPropertyType: "Company Valuation",
      ...overrides,
    });

  it("passes with FDI details and the shared income, exposure, and personal details", async () => {
    const result = await runChain(fdiLoanApplyValidator, fdiLoanPayload());
    expect(result.passed).toBe(true);
  });

  it("requires at least ₹100 crore in funds", async () => {
    const result = await runChain(fdiLoanApplyValidator, fdiLoanPayload({ loanAmount: 999999999 }));
    expect(result.passed).toBe(false);
  });

  it("requires collateral details and the shared exposure section", async () => {
    const result = await runChain(
      fdiLoanApplyValidator,
      fdiLoanPayload({ collateralPropertyCity: "", existingEMI: undefined })
    );
    expect(result.passed).toBe(false);
  });

  it("normalizes the more-than-10-years option to 11 years", () => {
    // Exactly as the deployed FDI form sends it: select value + free text, both strings.
    const payload = normalizeApplyPayload({ loanTenureYears: "-1", loanTenureYearsCustom: "11" });
    expect(payload.loanTenure).toBe(11);
    expect(payload.loanTenureYears).toBeUndefined();
    expect(payload.loanTenureYearsCustom).toBeUndefined();
  });

  it("validates a complete FDI application against its model", () => {
    const doc = new FdiLoan({ user: "64f000000000000000000001", ...fdiLoanPayload() });
    expect(doc.validateSync()).toBeUndefined();
  });

  it("registers FDI applications in the admin listing", async () => {
    jest.spyOn(FdiLoan, "find").mockReturnValue({
      sort: jest.fn().mockResolvedValue([{ loanType: "FDI Loan", loanAmount: 1000000000 }]),
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await listFdiLoans({}, res, jest.fn());

    expect(res.json.mock.calls[0][0].loans[0].loanType).toBe("FDI Loan");
  });
});

describe("balanceTransfer (Transfer Requirements)", () => {
  const balanceTransferPayload = (overrides = {}) => ({
    loanAmount: 1000000,
    loanTenure: 10,
    balanceTransferType: "Home loan",
    currentPropertyValue: 5000000,
    topUpAmount: 200000,
    employmentType: "Salaried",
    companyName: "ABC Corp",
    companyType: "Private Limited",
    monthlySalary: 75000,
    salaryReceivedAs: "Bank Transfer",
    salaryBankName: "HDFC Bank",
    fullName: "Rohit Sharma",
    mobile: "9876543210",
    email: "rohit@example.com",
    dob: "1992-06-15",
    panNumber: "ABCDE1234F",
    state: "Maharashtra",
    city: "Pune",
    pincode: "411001",
    residenceStatus: "Owned",
    ...overrides,
  });

  it("passes a complete salaried transfer payload", async () => {
    const result = await runChain(balanceTransferApplyValidator, balanceTransferPayload());
    expect(result.passed).toBe(true);
  });

  it("rejects a payload without the type of balance transfer", async () => {
    const result = await runChain(balanceTransferApplyValidator, balanceTransferPayload({ balanceTransferType: "" }));
    expect(result.passed).toBe(false);
  });

  it("validates a complete application against the model", () => {
    const doc = new BalanceTransfer({ user: "64f000000000000000000001", ...balanceTransferPayload() });
    expect(doc.validateSync()).toBeUndefined();
  });

  it("requires the type of balance transfer in the model", () => {
    const doc = new BalanceTransfer({
      user: "64f000000000000000000001",
      ...balanceTransferPayload({ balanceTransferType: undefined }),
    });
    const error = doc.validateSync();
    expect(error).toBeDefined();
    expect(Object.keys(error.errors)).toContain("balanceTransferType");
  });
});

describe("projectLoan (Loan Requirements)", () => {
  const projectLoanPayload = (overrides = {}) => ({
    loanAmount: 5000000,
    loanTenure: 10,
    projectType: "Construction Project",
    totalProjectCost: 10000000,
    projectStartDate: "2026-01-15",
    projectCompletionDate: "2028-06-30",
    ownInvestment: 2000000,
    employmentType: "Salaried",
    companyName: "ABC Corp",
    companyType: "Private Limited",
    monthlySalary: 75000,
    salaryReceivedAs: "Bank Transfer",
    salaryBankName: "HDFC Bank",
    fullName: "Rohit Sharma",
    mobile: "9876543210",
    email: "rohit@example.com",
    dob: "1992-06-15",
    panNumber: "ABCDE1234F",
    state: "Maharashtra",
    city: "Pune",
    pincode: "411001",
    residenceStatus: "Owned",
    ...overrides,
  });

  it("passes a complete salaried project payload", async () => {
    const result = await runChain(projectLoanApplyValidator, projectLoanPayload());
    expect(result.passed).toBe(true);
  });

  it("rejects a payload without the project type", async () => {
    const result = await runChain(projectLoanApplyValidator, projectLoanPayload({ projectType: "" }));
    expect(result.passed).toBe(false);
  });

  it("validates a complete application against the model", () => {
    const doc = new ProjectLoan({ user: "64f000000000000000000001", ...projectLoanPayload() });
    expect(doc.validateSync()).toBeUndefined();
  });

  it("requires the project type in the model", () => {
    const doc = new ProjectLoan({
      user: "64f000000000000000000001",
      ...projectLoanPayload({ projectType: undefined }),
    });
    const error = doc.validateSync();
    expect(error).toBeDefined();
    expect(Object.keys(error.errors)).toContain("projectType");
  });
});

describe("vehicleLoan (Loan Requirements)", () => {
  const vehicleLoanPayload = (overrides = {}) => ({
    loanAmount: 800000,
    loanTenure: 7,
    vehicleType: "SUV",
    transmissionType: "Automatic",
    fuelType: "Petrol",
    manufacturer: "Hyundai",
    model: "Creta",
    vehiclePurchaseType: "New Vehicle",
    employmentType: "Salaried",
    companyName: "ABC Corp",
    companyType: "Private Limited",
    monthlySalary: 75000,
    salaryReceivedAs: "Bank Transfer",
    salaryBankName: "HDFC Bank",
    fullName: "Rohit Sharma",
    mobile: "9876543210",
    email: "rohit@example.com",
    dob: "1992-06-15",
    panNumber: "ABCDE1234F",
    state: "Maharashtra",
    city: "Pune",
    pincode: "411001",
    residenceStatus: "Owned",
    ...overrides,
  });

  it("passes a complete salaried car payload", async () => {
    const result = await runChain(vehicleLoanApplyValidator, vehicleLoanPayload());
    expect(result.passed).toBe(true);
  });

  it("passes with only loanAmount + tenure (vehicle fields are optional)", async () => {
    const result = await runChain(
      vehicleLoanApplyValidator,
      vehicleLoanPayload({
        vehicleType: undefined,
        transmissionType: undefined,
        fuelType: undefined,
        manufacturer: undefined,
        model: undefined,
        vehiclePurchaseType: undefined,
      })
    );
    expect(result.passed).toBe(true);
  });

  it("requires the free-text partner when vehicleType is Other", async () => {
    const result = await runChain(
      vehicleLoanApplyValidator,
      vehicleLoanPayload({ vehicleType: "Other", vehicleTypeOther: "" })
    );
    expect(result.passed).toBe(false);
  });

  it("requires the free-text partner when fuelType is Other", async () => {
    const result = await runChain(
      vehicleLoanApplyValidator,
      vehicleLoanPayload({ fuelType: "Other", fuelTypeOther: "" })
    );
    expect(result.passed).toBe(false);
  });

  it("validates a complete application against the model", () => {
    const doc = new VehicleLoan({ user: "64f000000000000000000001", ...vehicleLoanPayload() });
    expect(doc.validateSync()).toBeUndefined();
  });
});

describe("educationLoan (Loan Requirements)", () => {
  const educationLoanPayload = (overrides = {}) => ({
    loanAmount: 1500000,
    loanTenure: 10,
    educationCountry: "Canada",
    fieldOfStudy: "Computer Science / IT",
    courseName: "B.Tech Computer Science",
    university: "University of Toronto",
    instituteName: "Faculty of Applied Science",
    enrollmentStatus: "Admission Confirmed",
    courseDuration: 4,
    educationCost: 45,
    employmentType: "Salaried",
    companyName: "ABC Corp",
    companyType: "Private Limited",
    monthlySalary: 75000,
    salaryReceivedAs: "Bank Transfer",
    salaryBankName: "HDFC Bank",
    fullName: "Rohit Sharma",
    mobile: "9876543210",
    email: "rohit@example.com",
    dob: "1992-06-15",
    panNumber: "ABCDE1234F",
    state: "Maharashtra",
    city: "Pune",
    pincode: "411001",
    residenceStatus: "Owned",
    ...overrides,
  });

  it("passes a complete salaried education payload", async () => {
    const result = await runChain(educationLoanApplyValidator, educationLoanPayload());
    expect(result.passed).toBe(true);
  });

  it("rejects a payload without the course name", async () => {
    const result = await runChain(educationLoanApplyValidator, educationLoanPayload({ courseName: "" }));
    expect(result.passed).toBe(false);
  });

  it("requires the free-text partner when fieldOfStudy is Other", async () => {
    const result = await runChain(
      educationLoanApplyValidator,
      educationLoanPayload({ fieldOfStudy: "Other", fieldOfStudyOther: "" })
    );
    expect(result.passed).toBe(false);
  });

  it("validates a complete application against the model", () => {
    const doc = new EducationLoan({ user: "64f000000000000000000001", ...educationLoanPayload() });
    expect(doc.validateSync()).toBeUndefined();
  });

  it("requires the education country in the model", () => {
    const doc = new EducationLoan({
      user: "64f000000000000000000001",
      ...educationLoanPayload({ educationCountry: undefined }),
    });
    const error = doc.validateSync();
    expect(error).toBeDefined();
    expect(Object.keys(error.errors)).toContain("educationCountry");
  });
});

describe("creditCard (Credit Card Details)", () => {
  const creditCardPayload = (overrides = {}) => ({
    hasActiveCard: "Yes",
    applyForBank: "HDFC",
    employmentType: "Salaried",
    companyName: "ABC Corp",
    companyType: "Private Limited",
    monthlySalary: 75000,
    salaryReceivedAs: "Bank Transfer",
    salaryBankName: "HDFC Bank",
    fullName: "Rohit Sharma",
    mobile: "9876543210",
    email: "rohit@example.com",
    dob: "1992-06-15",
    panNumber: "ABCDE1234F",
    state: "Maharashtra",
    city: "Pune",
    pincode: "411001",
    residenceStatus: "Owned",
    ...overrides,
  });

  it("passes without loanAmount/loanTenure (credit card has none)", async () => {
    const result = await runChain(creditCardApplyValidator, creditCardPayload());
    expect(result.passed).toBe(true);
  });

  it("rejects an invalid hasActiveCard value", async () => {
    const result = await runChain(creditCardApplyValidator, creditCardPayload({ hasActiveCard: "Maybe" }));
    expect(result.passed).toBe(false);
  });

  it("requires the free-text partner when applyForBank is Other", async () => {
    const result = await runChain(
      creditCardApplyValidator,
      creditCardPayload({ applyForBank: "Other", applyForBankOther: "" })
    );
    expect(result.passed).toBe(false);
  });

  it("validates a complete application against the model", () => {
    const doc = new CreditCard({ user: "64f000000000000000000001", ...creditCardPayload() });
    expect(doc.validateSync()).toBeUndefined();
  });

  it("does not require loanAmount or loanTenure in the model", () => {
    const doc = new CreditCard({ user: "64f000000000000000000001", ...creditCardPayload() });
    const error = doc.validateSync();
    const fields = error ? Object.keys(error.errors) : [];
    expect(fields).not.toContain("loanAmount");
    expect(fields).not.toContain("loanTenure");
  });
});

describe("employment type field scoping (schema registry)", () => {
  const {
    incomeFieldNamesForEmploymentType,
    businessIncomeFields,
  } = require("../src/modules/loans/shared/loanSchema");

  it("salaried applicants get only salaried income fields", () => {
    const fields = incomeFieldNamesForEmploymentType("Salaried");

    expect(fields).toContain("companyName");
    expect(fields).toContain("salaryBankName");
    expect(fields).not.toContain("profession");
    expect(fields).not.toContain("businessType");
    expect(fields).not.toContain("transactionBankName");
    expect(fields).not.toContain("businessState");
  });

  it("Self Employed - Business excludes professional-only fields", () => {
    const fields = incomeFieldNamesForEmploymentType("Self Employed - Business");

    expect(fields).toContain("businessType");
    expect(fields).toContain("businessName");
    expect(fields).toContain("lastYearTurnover");
    expect(fields).toContain("transactionBankName");
    expect(fields).toContain("businessState");
    expect(fields).not.toContain("profession");
    expect(fields).not.toContain("currentYearTurnover");
    expect(fields).not.toContain("priorYearTurnover");
    expect(fields).not.toContain("currentYearNetIncome");
    expect(fields).not.toContain("previousYearNetIncome");
  });

  it("Self Employed - Professional excludes business-only fields", () => {
    const fields = incomeFieldNamesForEmploymentType("Self Employed - Professional");

    expect(fields).toContain("profession");
    expect(fields).toContain("currentYearTurnover");
    expect(fields).toContain("priorYearTurnover");
    expect(fields).toContain("currentYearNetIncome");
    expect(fields).toContain("previousYearNetIncome");
    expect(fields).toContain("businessState");
    expect(fields).toContain("businessCity");
    expect(fields).toContain("businessPincode");
    expect(fields).toContain("businessPlaceStatus");
    expect(fields).toContain("transactionBankName");
    expect(fields).not.toContain("businessType");
    expect(fields).not.toContain("businessName");
    expect(fields).not.toContain("lastYearTurnover");
    expect(fields).not.toContain("lastYearNetIncome");
  });

  it("supportsTransactionBanks matches only the self-employed types", () => {
    const { buildLoanDocument } = require("../src/modules/loans/shared/loan.service");

    const business = buildLoanDocument("business", { employmentType: "Self Employed - Business", transactionBankOther: "Yes Bank" }, "u1");
    expect(business.transactionBankName).toEqual({ displayName: "Yes Bank", banks: ["Yes Bank"] });
    // The Other field is request-only input — never stored on the document.
    expect(business.transactionBankOther).toBeUndefined();
  });

  it("keeps transactionBankOther optional (stored only inside transactionBankName)", () => {
    expect(businessIncomeFields.transactionBankOther.type).toBe(String);
    expect(businessIncomeFields.transactionBankOther.required).toBeFalsy();
  });
});

describe("masters pincode lookup (state -> city -> pincodes)", () => {
  const masterService = require("../src/modules/masters/master.service");
  const Master = require("../src/modules/masters/master.model");

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockPincodesMaster = (values) =>
    jest.spyOn(Master, "findOne").mockResolvedValue({ values });

  it("returns the city's pincode list for an exact seed key", async () => {
    mockPincodesMaster({ "maharashtra::pune": ["411001", "411002"] });
    await expect(masterService.getPincodesForCity("Maharashtra", "Pune")).resolves.toEqual(["411001", "411002"]);
  });

  it("matches seed keys case-insensitively", async () => {
    mockPincodesMaster({ "Maharashtra::Pune": ["411001"] });
    await expect(masterService.getPincodesForCity("maharashtra", "PUNE")).resolves.toEqual(["411001"]);
  });

  it("answers [] for a city with no seeded pincodes (Other-input fallback)", async () => {
    mockPincodesMaster({ "maharashtra::pune": ["411001"] });
    await expect(masterService.getPincodesForCity("Maharashtra", "Nagpur")).resolves.toEqual([]);
  });

  it("answers [] when the master is missing or malformed", async () => {
    jest.spyOn(Master, "findOne").mockResolvedValue(null);
    await expect(masterService.getPincodesForCity("Maharashtra", "Pune")).resolves.toEqual([]);

    mockPincodesMaster("not-an-object");
    await expect(masterService.getPincodesForCity("Maharashtra", "Pune")).resolves.toEqual([]);
  });

  it("rejects empty state/city input", async () => {
    await expect(masterService.getPincodesForCity("", "Pune")).rejects.toMatchObject({ statusCode: 400 });
    await expect(masterService.getPincodesForCity("Maharashtra", "  ")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("lists all seeded locations", async () => {
    mockPincodesMaster({ "maharashtra::pune": ["411001"], "gujarat::ahmedabad": ["380001"] });
    await expect(masterService.listPincodeLocations()).resolves.toEqual(["gujarat::ahmedabad", "maharashtra::pune"]);
  });
});
