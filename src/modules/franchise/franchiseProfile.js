const FRANCHISE_PROFILE_FIELDS = [
  "franchiseStatus",
  "franchiseId",
  "panNumber",
  "state",
  "city",
  "pincode",
  "package",
  "plan",
  "businessDetails",
  "franchiseAppliedAt",
  "franchiseApprovedAt",
  "franchiseRejectedAt",
];

const APPLICATION_FIELDS = FRANCHISE_PROFILE_FIELDS.filter((field) => field !== "franchiseStatus");

const sanitizeFranchiseProfile = (franchise) => {
  if (!franchise) return null;

  const profile = typeof franchise.toObject === "function" ? franchise.toObject() : { ...franchise };

  APPLICATION_FIELDS.forEach((field) => {
    const value = profile[field];
    const emptyObject =
      value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;

    if (value === undefined || value === null || value === "" || emptyObject) {
      delete profile[field];
    }
  });

  return profile;
};

module.exports = { FRANCHISE_PROFILE_FIELDS, sanitizeFranchiseProfile };
