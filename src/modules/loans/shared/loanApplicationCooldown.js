const APPLICATION_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

const hasRecentDirectApplication = async (Model, userId) =>
  Model.findOne({
    user: userId,
    franchise: null,
    createdAt: { $gt: new Date(Date.now() - APPLICATION_COOLDOWN_MS) },
  })
    .sort({ createdAt: -1 })
    .select({ createdAt: 1 })
    .lean();

const createApplicationCooldownError = (application, loanType, now = new Date()) => {
  const retryAt = new Date(new Date(application.createdAt).getTime() + APPLICATION_COOLDOWN_MS);
  const remainingSeconds = Math.max(0, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
  let secondsToFormat = remainingSeconds;

  const days = Math.floor(secondsToFormat / 86400);
  secondsToFormat %= 86400;
  const hours = Math.floor(secondsToFormat / 3600);
  secondsToFormat %= 3600;
  const minutes = Math.floor(secondsToFormat / 60);
  const seconds = secondsToFormat % 60;
  const remainingParts = [];

  if (days) remainingParts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) remainingParts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) remainingParts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (!remainingParts.length) remainingParts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);

  const error = new Error(
    `You have already applied for the ${loanType}. Please wait ${remainingParts.join(", ")} before applying again.`
  );
  error.statusCode = 409;
  error.retryAfter = {
    days,
    hours,
    minutes,
    seconds,
    availableAt: retryAt.toISOString(),
  };

  return error;
};

module.exports = {
  APPLICATION_COOLDOWN_MS,
  hasRecentDirectApplication,
  createApplicationCooldownError,
};
