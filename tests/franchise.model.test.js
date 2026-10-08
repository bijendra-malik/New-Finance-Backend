const Franchise = require("../src/modules/franchise/franchise.model");
const User = require("../src/modules/auth/user.model");
const { buildLoanSchema } = require("../src/modules/loans/shared/loanSchema");
const { USER_ROLE, FRANCHISE_STATUS } = require("../src/constants/roles");

/*
Franchise ka apna collection — customers (`users`) se alag. Ye test us
separation ko lock karta hai, taaki koi galti se franchise field wapas customer
schema me na daal de.
*/

describe("Franchise collection separation", () => {
  it("franchises live in their own collection, customers in `users`", () => {
    expect(Franchise.modelName).toBe("Franchise");
    expect(Franchise.collection.name).toBe("franchises");
    expect(User.collection.name).toBe("users");
  });

  it("keeps franchise-only fields on the franchise schema", () => {
    ["franchiseStatus", "franchiseId", "panNumber", "state", "city", "pincode", "package", "businessDetails", "password"].forEach(
      (field) => {
        expect(Franchise.schema.path(field)).toBeDefined();
      }
    );

    // Login password kabhi default select na ho.
    expect(Franchise.schema.path("password").options.select).toBe(false);
    // FRN code public login id hai — unique + sparse.
    expect(Franchise.schema.path("franchiseId").options.unique).toBe(true);
    expect(Franchise.schema.path("franchiseId").options.sparse).toBe(true);
  });

  it("defaults a new franchise to role Franchise / status None (no approval yet)", () => {
    expect(Franchise.schema.path("role").options.default).toBe(USER_ROLE.FRANCHISE);
    expect(Franchise.schema.path("role").options.enum).toEqual([USER_ROLE.FRANCHISE]);
    expect(Franchise.schema.path("franchiseStatus").options.default).toBe(FRANCHISE_STATUS.NONE);
  });

  it("no longer carries franchise fields on the customer schema", () => {
    ["franchiseStatus", "franchiseId", "package", "businessDetails", "password", "panNumber"].forEach((field) => {
      expect(User.schema.path(field)).toBeUndefined();
    });

    // Legacy \"User\" + migration se pehle ke franchise documents save hone chahiye.
    expect(User.schema.path("role").options.enum).toEqual(
      expect.arrayContaining([USER_ROLE.CUSTOMER, USER_ROLE.FRANCHISE, USER_ROLE.LEGACY_CUSTOMER])
    );
  });

  it("loan documents reference the Franchise model for the channel link", () => {
    const loanSchema = buildLoanSchema("personal");

    expect(loanSchema.path("franchise").options.ref).toBe("Franchise");
    expect(loanSchema.path("franchise").options.default).toBeNull();
    expect(loanSchema.path("franchiseCode").options.default).toBeNull();
  });
});
