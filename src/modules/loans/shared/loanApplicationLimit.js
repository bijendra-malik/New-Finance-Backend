const { randomUUID } = require("crypto");
const User = require("../../auth/user.model");

const LOAN_APPLICATION_LIMIT = 3;
const LOAN_APPLICATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const activeAttemptsExpression = (cutoff) => ({
  $filter: {
    input: { $ifNull: ["$loanApplicationAttempts", []] },
    as: "attempt",
    cond: { $gt: ["$$attempt.at", cutoff] },
  },
});

const limitError = (attempts, now) => {
  const activeAttempts = attempts
    .filter((attempt) => new Date(attempt.at).getTime() > now.getTime() - LOAN_APPLICATION_WINDOW_MS)
    .sort((left, right) => new Date(left.at) - new Date(right.at));
  if (activeAttempts.length < LOAN_APPLICATION_LIMIT) {
    const error = new Error("Could not reserve a loan application slot. Please try again.");
    error.statusCode = 503;
    return error;
  }

  const availableAt = new Date(new Date(activeAttempts[0].at).getTime() + LOAN_APPLICATION_WINDOW_MS);
  const remainingSeconds = Math.max(0, Math.ceil((availableAt.getTime() - now.getTime()) / 1000));
  let secondsToFormat = remainingSeconds;
  const hours = Math.floor(secondsToFormat / 3600);
  secondsToFormat %= 3600;
  const minutes = Math.floor(secondsToFormat / 60);
  const seconds = secondsToFormat % 60;
  const wait = [];

  if (hours) wait.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) wait.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (!wait.length) wait.push(`${seconds} second${seconds === 1 ? "" : "s"}`);

  const error = new Error(
    `You can submit up to ${LOAN_APPLICATION_LIMIT} loan applications in 24 hours. Please wait ${wait.join(", ")} before applying again.`
  );
  error.statusCode = 429;
  error.retryAfter = {
    hours,
    minutes,
    seconds,
    availableAt: availableAt.toISOString(),
  };
  return error;
};

const reserveLoanApplicationSlot = async (userId, now = new Date()) => {
  const cutoff = new Date(now.getTime() - LOAN_APPLICATION_WINDOW_MS);
  const token = randomUUID();
  const activeAttempts = activeAttemptsExpression(cutoff);
  const reservation = { token, at: now };

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      $expr: { $lt: [{ $size: activeAttempts }, LOAN_APPLICATION_LIMIT] },
    },
    [
      {
        $set: {
          loanApplicationAttempts: {
            $concatArrays: [activeAttempts, [reservation]],
          },
        },
      },
    ],
    { new: true, projection: { _id: 1 }, timestamps: false }
  );

  if (updatedUser) return token;

  const user = await User.findById(userId).select("+loanApplicationAttempts").lean();
  if (!user) {
    const error = new Error("Customer account not found.");
    error.statusCode = 404;
    throw error;
  }

  throw limitError(user.loanApplicationAttempts || [], now);
};

const releaseLoanApplicationSlot = async (userId, token) => {
  const result = await User.updateOne(
    { _id: userId },
    { $pull: { loanApplicationAttempts: { token } } },
    { timestamps: false }
  );
  if (result.modifiedCount !== 1) {
    throw new Error("The loan application attempt reservation was not released.");
  }
  return result;
};

const createLoanApplicationWithLimit = async (userId, createApplication) => {
  const token = await reserveLoanApplicationSlot(userId);

  try {
    return await createApplication();
  } catch (error) {
    try {
      await releaseLoanApplicationSlot(userId, token);
    } catch (releaseError) {
      const combinedError = new Error(
        "Loan application could not be saved and its attempt reservation could not be released."
      );
      combinedError.cause = error;
      combinedError.releaseError = releaseError;
      throw combinedError;
    }

    throw error;
  }
};

module.exports = {
  LOAN_APPLICATION_LIMIT,
  LOAN_APPLICATION_WINDOW_MS,
  reserveLoanApplicationSlot,
  releaseLoanApplicationSlot,
  createLoanApplicationWithLimit,
};
