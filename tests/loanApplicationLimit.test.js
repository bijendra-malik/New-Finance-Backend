const User = require("../src/modules/auth/user.model");
const {
  LOAN_APPLICATION_LIMIT,
  reserveLoanApplicationSlot,
} = require("../src/modules/loans/shared/loanApplicationLimit");

const USER_ID = "64f000000000000000000009";

const attemptsWithinWindow = (count) =>
  Array.from({ length: count }, (_, index) => ({
    token: `t-${index}`,
    at: new Date(Date.now() - index * 60 * 1000),
  }));

describe("reserveLoanApplicationSlot", () => {
  let findOneAndUpdateSpy;
  let findByIdSpy;

  beforeEach(() => {
    findOneAndUpdateSpy = jest.spyOn(User, "findOneAndUpdate");
    findByIdSpy = jest.spyOn(User, "findById");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("marks the pipeline update with updatePipeline so Mongoose 9 accepts the array", async () => {
    findOneAndUpdateSpy.mockReturnValue({ _id: USER_ID });

    const token = await reserveLoanApplicationSlot(USER_ID);

    expect(typeof token).toBe("string");
    expect(token).toHaveLength(36);

    const [filter, update, options] = findOneAndUpdateSpy.mock.calls[0];

    /* Array (aggregation pipeline) update — Mongoose 9 throws without the flag. */
    expect(Array.isArray(update)).toBe(true);
    expect(options.updatePipeline).toBe(true);
    expect(filter._id).toBe(USER_ID);
    expect(filter.$expr).toBeDefined();
  });

  it("returns the reservation token when a slot was taken", async () => {
    findOneAndUpdateSpy.mockReturnValue({ _id: USER_ID });

    const token = await reserveLoanApplicationSlot(USER_ID);

    expect(findOneAndUpdateSpy).toHaveBeenCalledTimes(1);
    expect(typeof token).toBe("string");
    expect(findByIdSpy).not.toHaveBeenCalled();
  });

  it("reports how long to wait when the 3-per-24h limit is reached", async () => {
    findOneAndUpdateSpy.mockReturnValue(null);
    findByIdSpy.mockReturnValue({
      select: () => ({
        lean: async () => ({ loanApplicationAttempts: attemptsWithinWindow(LOAN_APPLICATION_LIMIT) }),
      }),
    });

    await expect(reserveLoanApplicationSlot(USER_ID)).rejects.toMatchObject({
      statusCode: 429,
      message: expect.stringContaining(`up to ${LOAN_APPLICATION_LIMIT} loan applications`),
    });
  });

  it("fails with 503 when no slot is free but the account is under the limit", async () => {
    findOneAndUpdateSpy.mockReturnValue(null);
    findByIdSpy.mockReturnValue({
      select: () => ({
        lean: async () => ({ loanApplicationAttempts: attemptsWithinWindow(1) }),
      }),
    });

    await expect(reserveLoanApplicationSlot(USER_ID)).rejects.toMatchObject({
      statusCode: 503,
      message: "Could not reserve a loan application slot. Please try again.",
    });
  });
});
