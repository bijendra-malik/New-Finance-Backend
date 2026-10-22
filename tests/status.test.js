jest.mock("../src/utils/sendOTP", () => jest.fn().mockResolvedValue(true));

const sendOTP = require("../src/utils/sendOTP");
const User = require("../src/modules/auth/user.model");
const OTP = require("../src/modules/auth/otp.model");
const statusController = require("../src/modules/status/status.controller");
const { requestOtpValidator, statusValidator } = require("../src/modules/status/status.validator");
const {
  IDENTITY_MISMATCH_MESSAGE,
  STATUS_OTP_PURPOSE,
  requestStatusOtp,
  getApplicationStatus,
  findStatusCustomer,
  findStatusCustomerByMobile,
} = require("../src/modules/status/status.service");
const { MODELS } = require("../src/modules/loans/shared/loanStatus");

const account = {
  _id: "customer-id",
  customerId: "CUST000001",
  name: "Rahul Sharma",
  mobile: "9876543210",
  panNumber: "ABCDE1234F",
  role: "Customer",
};

/** Baaki products par koi application nahi. */
const stubApplications = (applications) => {
  Object.entries(MODELS).forEach(([productKey, Model]) => {
    const rows = applications[productKey] || [];
    jest.spyOn(Model, "find").mockReturnValue({
      sort: () => Promise.resolve(rows),
    });
  });
};

describe("statusService (public status door)", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.STATIC_OTP = "123456";
    jest.spyOn(User, "findOne").mockResolvedValue(account);
    jest.spyOn(OTP, "findOne").mockResolvedValue(null);
    jest.spyOn(OTP, "deleteMany").mockResolvedValue({ deletedCount: 1 });
    jest.spyOn(OTP, "create").mockResolvedValue({});
    sendOTP.mockClear();
    sendOTP.mockResolvedValue(true);
  });

  it("rejects a malformed customer ID and PAN before touching the database", async () => {
    await expect(findStatusCustomer({ customerId: "CUST1", panNumber: "ABCDE1234F" })).rejects.toThrow(
      "Enter a valid customer ID"
    );
    await expect(findStatusCustomer({ customerId: "CUST000001", panNumber: "abc" })).rejects.toThrow(
      "Enter a valid PAN number"
    );
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it("gives the same 404 answer for an unknown customer and for a wrong PAN", async () => {
    User.findOne.mockResolvedValue(null);
    await expect(
      findStatusCustomer({ customerId: "CUST000001", panNumber: "ABCDE1234F" })
    ).rejects.toThrow(IDENTITY_MISMATCH_MESSAGE);

    User.findOne.mockResolvedValue(account);
    await expect(
      findStatusCustomer({ customerId: "CUST000001", panNumber: "ZZZZZ9999Z" })
    ).rejects.toThrow(IDENTITY_MISMATCH_MESSAGE);
  });

  it("requires the provided mobile to match the customer's registered mobile", async () => {
    await expect(
      requestStatusOtp({
        customerId: "CUST000001",
        panNumber: "ABCDE1234F",
        mobile: "9876543211",
      })
    ).rejects.toThrow(IDENTITY_MISMATCH_MESSAGE);
    expect(sendOTP).not.toHaveBeenCalled();
  });

  it("sends the OTP to the registered mobile", async () => {
    const result = await requestStatusOtp({
      customerId: "cust000001",
      panNumber: "abcde1234f",
      mobile: "9876543210",
    });

    expect(sendOTP).toHaveBeenCalledWith("9876543210", "123456");
    expect(result.mobileMasked).toBe("98******10");
    expect(result.message).toContain("98******10");
  });

  it("keeps the status OTP in its own purpose so an entry OTP survives", async () => {
    await requestStatusOtp({
      customerId: "CUST000001",
      panNumber: "ABCDE1234F",
      mobile: "9876543210",
    });

    expect(OTP.deleteMany).toHaveBeenCalledWith({ mobile: "9876543210", purpose: STATUS_OTP_PURPOSE });
    expect(OTP.create).toHaveBeenCalledWith(
      expect.objectContaining({ mobile: "9876543210", purpose: STATUS_OTP_PURPOSE, pendingDetails: null })
    );
  });

  it("rejects a wrong OTP and an OTP that was never requested", async () => {
    OTP.findOne.mockResolvedValue({ otp: "123456", save: jest.fn() });
    await expect(getApplicationStatus({ mobile: "9876543210", otp: "000000" })).rejects.toThrow(
      "Invalid OTP"
    );

    OTP.findOne.mockResolvedValue(null);
    await expect(getApplicationStatus({ mobile: "9876543210", otp: "123456" })).rejects.toThrow(
      "OTP Not Found"
    );
  });

  it("resolves only a registered customer account by mobile", async () => {
    await expect(findStatusCustomerByMobile("invalid")).rejects.toThrow("valid 10-digit mobile");
    await expect(findStatusCustomerByMobile("0876543210")).rejects.toThrow("valid 10-digit mobile");
    expect(User.findOne).not.toHaveBeenCalled();

    User.findOne.mockResolvedValue({ ...account, customerId: undefined });
    await expect(findStatusCustomerByMobile("9876543210")).rejects.toThrow("Customer not found");
  });

  it("returns the admin-style process view, newest application first", async () => {
    const otpData = { otp: "123456", save: jest.fn().mockResolvedValue(undefined) };
    OTP.findOne.mockResolvedValue(otpData);
    stubApplications({
      personal: [
        {
          toObject: () => ({
            _id: "p1",
            applicationNo: "LOAN000020",
            user: "customer-id",
            franchise: null,
            loanType: "Personal Loan",
            loanAmount: 300000,
            status: "Pending",
            adminNote: "Documents received",
            createdAt: "2026-10-10T00:00:00.000Z",
            updatedAt: "2026-10-11T00:00:00.000Z",
          }),
        },
      ],
      business: [
        {
          toObject: () => ({
            _id: "b1",
            applicationNo: "LOAN000030",
            user: "customer-id",
            franchise: "franchise-id",
            franchiseCode: "FRN000001",
            loanType: "Business Loan",
            loanAmount: 1000000,
            status: "Approved",
            approvedAt: "2026-10-14T00:00:00.000Z",
            createdAt: "2026-10-12T00:00:00.000Z",
          }),
        },
      ],
    });

    const result = await getApplicationStatus({
      mobile: "9876543210",
      otp: "123456",
    });

    expect(result.total).toBe(2);
    expect(result.byStatus).toEqual({ Submitted: 0, Pending: 1, Approved: 1, Rejected: 0 });
    expect(result.stages.length).toBeGreaterThan(1);
    expect(result.customer).toMatchObject({ customerId: "CUST000001", mobileMasked: "98******10" });

    const [newest, older] = result.applications;
    expect(newest).toMatchObject({
      applicationNo: "LOAN000030",
      product: "business",
      status: "Approved",
      stage: "Approved",
      franchiseCode: "FRN000001",
    });
    expect(newest.timeline.map((step) => step.step)).toEqual(["Application Submitted", "Approved"]);

    expect(older).toMatchObject({
      applicationNo: "LOAN000020",
      status: "Pending",
      stage: "Under Review",
      adminNote: "Documents received",
    });
    expect(older.timeline.map((step) => step.step)).toEqual(["Application Submitted", "Under Review"]);

    expect(otpData.save).toHaveBeenCalled();
  });

  it("answers with an empty list for a customer who has not applied yet", async () => {
    OTP.findOne.mockResolvedValue({ otp: "123456", save: jest.fn() });
    stubApplications({});

    const result = await getApplicationStatus({
      mobile: "9876543210",
      otp: "123456",
    });

    expect(result.total).toBe(0);
    expect(result.applications).toEqual([]);
    expect(result.byStatus).toEqual({ Submitted: 0, Pending: 0, Approved: 0, Rejected: 0 });
  });
});

describe("statusController", () => {
  /** Runs a controller like the real route does and reports the response. */
  const runController = (handler, body) =>
    new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          resolve({ statusCode: this.statusCode, payload });
        },
      };

      handler({ body }, res, (error) => resolve({ statusCode: 500, payload: { message: error.message } }));
    });

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.STATIC_OTP = "123456";
    jest.spyOn(User, "findOne").mockResolvedValue(account);
    jest.spyOn(OTP, "deleteMany").mockResolvedValue({ deletedCount: 1 });
    jest.spyOn(OTP, "create").mockResolvedValue({});
    sendOTP.mockClear();
    sendOTP.mockResolvedValue(true);
  });

  it("never returns a token or the full mobile number", async () => {
    const { payload } = await runController(statusController.requestOtp, {
      customerId: "CUST000001",
      panNumber: "ABCDE1234F",
      mobile: "9876543210",
    });

    expect(payload).toEqual({
      success: true,
      message: "OTP sent to 98******10",
      mobileMasked: "98******10",
      nextStep: "status",
    });
    expect(payload).not.toHaveProperty("token");
    expect(JSON.stringify(payload)).not.toContain("9876543210");
  });

  it("passes a service error to the error middleware", async () => {
    User.findOne.mockResolvedValue(null);

    const result = await runController(statusController.requestOtp, {
      customerId: "CUST000001",
      panNumber: "ABCDE1234F",
      mobile: "9876543210",
    });

    expect(result.payload.message).toBe(IDENTITY_MISMATCH_MESSAGE);
  });
});

describe("status validators", () => {
  const runValidators = (validators, body) =>
    new Promise((resolve) => {
      const req = { body };
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          resolve({ statusCode: this.statusCode, payload });
        },
      };
      let index = 0;
      const next = (error) => {
        if (error) return resolve({ statusCode: 500, payload: { message: error.message } });
        if (index === validators.length) return resolve({ statusCode: res.statusCode });
        validators[index++](req, res, next);
      };
      next();
    });

  it("requires customer ID, PAN, and mobile when requesting the status OTP", async () => {
    const result = await runValidators(requestOtpValidator, {
      customerId: "CUST000001",
      panNumber: "ABCDE1234F",
    });

    expect(result.statusCode).toBe(400);
    expect(result.payload.message).toBe("Enter a valid 10-digit mobile number");
  });

  it("accepts only mobile and OTP as the status verification fields", async () => {
    const result = await runValidators(statusValidator, {
      mobile: "9876543210",
      otp: "123456",
    });

    expect(result.statusCode).toBe(200);
  });
});
