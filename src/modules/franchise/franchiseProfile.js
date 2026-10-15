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

/*
Sirf franchise-only fields — inhe customer profile se hatate hain.
Baaki list ke fields (panNumber, state, city, pincode) customer ke APNE verified
identity/address fields hain: entry form ke mobile OTP par save hote hain aur
loan form inhi se prefill hota hai, isliye profile me rehte hain.
*/
const FRANCHISE_ONLY_PROFILE_FIELDS = [
  "franchiseStatus",
  "franchiseId",
  "package",
  "plan",
  "businessDetails",
  "franchiseAppliedAt",
  "franchiseApprovedAt",
  "franchiseRejectedAt",
];

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

module.exports = {
  FRANCHISE_PROFILE_FIELDS,
  FRANCHISE_ONLY_PROFILE_FIELDS,
  sanitizeFranchiseProfile,
};
