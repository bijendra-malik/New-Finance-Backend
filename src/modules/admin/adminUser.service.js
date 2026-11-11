const bcrypt = require("bcryptjs");
const Admin = require("./admin.model");
const User = require("../auth/user.model");
const Franchise = require("../franchise/franchise.model");
const { MODELS } = require("../loans/shared/loanModels");
const { isValidEmail } = require("../../utils/validators");
const { LOAN_TYPE_SLUGS, LOAN_ACCESS_ALL } = require("../../constants/loanTypes");
const { MODULE_ACCESS_KEYS, MODULE_ACCESS_ALL } = require("./adminLoanAccess");
const {
  ADMIN_ROLE,
  ADMIN_PERMISSION_KEYS,
  DEFAULT_SUB_ADMIN_PERMISSIONS,
  appliesToScope,
  filterPermissionsForScope,
  normalizePermissions,
} = require("../../constants/adminPermissions");

/*
==========================================
Admin team management.

Super admin yahan se naye admin bana sakta hai, unka role badal sakta hai aur
tay kar sakta hai ki admin customer records (`moduleAccess`) aur kaun se loan
product workspaces (`loanAccess`) dekh sakta hai.

Rules jo service khud enforce karta hai (frontend par bharosa nahi):
  - sirf ek SuperAdmin hi in routes tak pahunchta hai (middleware),
  - khud ka super admin role hataya nahi ja sakta,
  - aakhri super admin delete/demote nahi ho sakta,
  - khud ko delete nahi kiya ja sakta.
==========================================
*/

const ROLE = {
  SUPER: ADMIN_ROLE.SUPER,
  SUB: ADMIN_ROLE.SUB,
  ADMIN: ADMIN_ROLE.ADMIN,
};

const LOGIN_ID_REGEX = /^[a-z0-9][a-z0-9._-]{2,23}$/i;
const MIN_PASSWORD_LENGTH = 6;
/** Super admin can create at most this many regular admins. */
const MAX_REGULAR_ADMINS = 25;

const fail = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const badRequest = (message) => fail(400, message);
const notFound = (message = "Admin not found") => fail(404, message);

/* ---------------------------- normalisation ---------------------------- */

const normalizeRole = (value, fallback = ROLE.ADMIN) => {
  if (value === undefined || value === null || value === "") return fallback;
  const raw = String(value).trim();
  if (/^super[_\s-]?admin$/i.test(raw)) return ROLE.SUPER;
  if (/^sub[_\s-]?admin$/i.test(raw)) return ROLE.SUB;
  if (/^admin$/i.test(raw)) return ROLE.ADMIN;
  throw badRequest("Role must be Admin, SubAdmin or SuperAdmin");
};

const normalizeLoanAccess = (value, role) => {
  if (role === ROLE.SUPER) return LOAN_ACCESS_ALL;
  if (value === undefined) return [];
  if (value === LOAN_ACCESS_ALL) return LOAN_ACCESS_ALL;
  if (!Array.isArray(value)) {
    throw badRequest('loanAccess must be "all" or an array of loan slugs');
  }

  const unique = [...new Set(value.map((entry) => String(entry).trim()))].filter(Boolean);
  const invalid = unique.filter((slug) => !LOAN_TYPE_SLUGS.includes(slug));
  if (invalid.length) {
    throw badRequest(`Unknown loan type(s): ${invalid.join(", ")}`);
  }
  return unique;
};

const normalizeModuleAccess = (value, role) => {
  if (role === ROLE.SUPER) return MODULE_ACCESS_ALL;
  if (value === undefined || value === null) return [];
  if (value === MODULE_ACCESS_ALL) return MODULE_ACCESS_ALL;
  if (!Array.isArray(value)) {
    throw badRequest('moduleAccess must be "all" or an array of module keys');
  }

  const unique = [...new Set(value.map((entry) => String(entry).trim()))].filter(Boolean);
  const invalid = unique.filter((key) => !MODULE_ACCESS_KEYS.includes(key));
  if (invalid.length) {
    throw badRequest(`Unknown module(s): ${invalid.join(", ")}`);
  }
  return unique;
};

/* ------------------------------ sub-admin scope ------------------------------ */

const hasLoanScope = (loanAccess) =>
  loanAccess === LOAN_ACCESS_ALL ||
  (Array.isArray(loanAccess) && loanAccess.length > 0);

const hasModuleScope = (moduleAccess) =>
  moduleAccess === MODULE_ACCESS_ALL ||
  (Array.isArray(moduleAccess) && moduleAccess.length > 0);

/**
 * Sub admin ka scope wahi hai jo regular admin ka access hota hai:
 * Loan products YA Customers & Franchises. Dono ek saath nahi — warna
 * dashboard aur review queue ka matlab hi ambiguous ho jaata hai.
 */
const scopeOf = ({ loanAccess, moduleAccess } = {}) => {
  const loans = hasLoanScope(loanAccess);
  const modules = hasModuleScope(moduleAccess);

  if (loans && modules) {
    throw badRequest(
      "Sub admin ka scope ek hi ho sakta hai: loan products ya customers / franchises"
    );
  }
  if (modules) return "modules";
  if (loans) return "loans";
  return null;
};

/**
 * Sub admin permissions ko uske scope se bandhte hain:
 *   - scope ke bahar ki permission request 400,
 *   - chuni hui scope me kam se kam ek permission zaroori,
 *   - `loans.decide` sirf loan scope me.
 * SuperAdmin ke paas hamesha poori list hoti hai; regular admin ke paas kuch nahi.
 */
const resolvePermissions = (value, role, access) => {
  if (role === ROLE.SUPER) return ADMIN_PERMISSION_KEYS;
  if (role !== ROLE.SUB) return [];

  const scope = scopeOf(access);
  if (!scope) {
    throw badRequest(
      "Sub admin ke liye scope chuno: loan products ya customers / franchises"
    );
  }

  const provided = value === undefined || value === null;
  const requested = provided
    ? DEFAULT_SUB_ADMIN_PERMISSIONS
    : normalizePermissions(value);

  const outOfScope = provided
    ? []
    : requested.filter((key) => !appliesToScope(key, scope));
  if (outOfScope.length) {
    throw badRequest(
      `Ye permission is scope me nahi hai: ${outOfScope.join(", ")}`
    );
  }

  const scoped = filterPermissionsForScope(requested, scope);
  if (!scoped.length) {
    throw badRequest(
      `Kam se kam ek permission chuno (${
        scope === "loans" ? "loan products" : "customers / franchises"
      } scope)`
    );
  }
  return scoped;
};

const deriveLoginId = (email) => String(email ?? "").split("@")[0].toLowerCase();

const assertPassword = (password) => {
  if (String(password ?? "").length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
};

const assertEmail = async (email, exceptId) => {
  if (!isValidEmail(email)) throw badRequest("Enter a valid email address");
  const cleanEmail = String(email).toLowerCase().trim();
  const query = { email: cleanEmail };
  if (exceptId) query._id = { $ne: exceptId };
  const clash = await Admin.findOne(query).select("_id");
  if (clash) throw badRequest("An admin with this email already exists");
  return cleanEmail;
};

const assertLoginId = async (loginId, exceptId) => {
  const clean = String(loginId ?? "").trim().toLowerCase();
  if (!LOGIN_ID_REGEX.test(clean)) {
    throw badRequest(
      "Admin ID must be 3-24 characters: letters, numbers, dot, dash or underscore"
    );
  }
  const query = { loginId: clean };
  if (exceptId) query._id = { $ne: exceptId };
  const clash = await Admin.findOne(query).select("_id");
  if (clash) throw badRequest("This admin ID is already taken");
  return clean;
};

/**
==========================================
Regular admin seats.

Super admin 25 se zyada regular admin nahi bana sakta — count sirf `Admin` role
ka hota hai, super admins isme nahi gine jaate.
==========================================
*/
const assertAdminSeat = async () => {
  // Sub admins bhi super admin ke banaye seats hain, isliye limit me ginte hain.
  const used = await Admin.countDocuments({ role: { $in: [ROLE.ADMIN, ROLE.SUB] } });
  if (used >= MAX_REGULAR_ADMINS) {
    throw badRequest(
      `Limit reached: only ${MAX_REGULAR_ADMINS} regular admins can be created. Delete one to add another.`
    );
  }
};

const countOtherSuperAdmins = async (exceptId) => {
  const query = { role: ROLE.SUPER, isActive: true };
  if (exceptId) query._id = { $ne: exceptId };
  return Admin.countDocuments(query);
};

/* ------------------------------ serialising ----------------------------- */

const toPublic = (admin) => {
  const doc = typeof admin.toObject === "function" ? admin.toObject() : admin;
  return {
    _id: doc._id,
    loginId: doc.loginId || deriveLoginId(doc.email),
    name: doc.name,
    email: doc.email,
    role: doc.role,
    permissions:
      doc.role === ROLE.SUPER
        ? ADMIN_PERMISSION_KEYS
        : normalizePermissions(doc.permissions),
    loanAccess: doc.role === ROLE.SUPER ? LOAN_ACCESS_ALL : doc.loanAccess ?? [],
    moduleAccess: doc.role === ROLE.SUPER ? MODULE_ACCESS_ALL : doc.moduleAccess ?? [],
    isActive: doc.isActive !== false,
    lastLogin: doc.lastLogin ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

/* -------------------------------- service ------------------------------- */

const listAdmins = async () => {
  const admins = await Admin.find({}).sort({ createdAt: 1 });
  return admins.map(toPublic);
};

const createAdmin = async ({
  loginId,
  name,
  email,
  password,
  role,
  loanAccess,
  moduleAccess,
  permissions,
}) => {
  const cleanName = String(name ?? "").trim();
  if (cleanName.length < 2) throw badRequest("Name is required");
  if (cleanName.length > 100) throw badRequest("Name is too long (max 100 characters)");

  assertPassword(password);

  const cleanEmail = await assertEmail(email);
  const cleanRole = normalizeRole(role);
  // Super admin seats unlimited; Admin aur SubAdmin dono 25 ki limit me.
  if (cleanRole !== ROLE.SUPER) await assertAdminSeat();
  const cleanLoginId = await assertLoginId(
    String(loginId ?? "").trim() || deriveLoginId(cleanEmail)
  );
  const access = normalizeLoanAccess(loanAccess, cleanRole);
  const modAccess = normalizeModuleAccess(moduleAccess, cleanRole);
  const grantedPermissions = resolvePermissions(permissions, cleanRole, {
    loanAccess: access,
    moduleAccess: modAccess,
  });

  const admin = await Admin.create({
    name: cleanName,
    email: cleanEmail,
    loginId: cleanLoginId,
    password: await bcrypt.hash(String(password), 10),
    role: cleanRole,
    loanAccess: access,
    moduleAccess: modAccess,
    permissions: grantedPermissions,
  });

  return toPublic(admin);
};

const updateAdmin = async (id, patch = {}, actorId) => {
  const admin = await Admin.findById(id);
  if (!admin) throw notFound();

  const isSelf = String(admin._id) === String(actorId);
  const nextRole = normalizeRole(patch.role, admin.role);
  // Demoting a super admin into a regular seat must respect the same 25 cap.
  if (nextRole === ROLE.ADMIN && admin.role !== ROLE.ADMIN) await assertAdminSeat();

  if (admin.role === ROLE.SUPER && nextRole !== ROLE.SUPER) {
    if (isSelf) throw badRequest("You cannot remove your own super admin role");
    if ((await countOtherSuperAdmins(admin._id)) === 0) {
      throw badRequest("At least one super admin must remain");
    }
  }

  if (patch.name !== undefined) {
    const cleanName = String(patch.name).trim();
    if (cleanName.length < 2) throw badRequest("Name is required");
    if (cleanName.length > 100) throw badRequest("Name is too long (max 100 characters)");
    admin.name = cleanName;
  }

  if (patch.email !== undefined) {
    admin.email = await assertEmail(patch.email, admin._id);
  }

  const demotingSuperAdmin = admin.role === ROLE.SUPER && nextRole !== ROLE.SUPER;
  admin.role = nextRole;
  if (patch.loanAccess !== undefined || nextRole === ROLE.SUPER || demotingSuperAdmin) {
    admin.loanAccess = normalizeLoanAccess(patch.loanAccess, nextRole);
  }
  if (patch.moduleAccess !== undefined || nextRole === ROLE.SUPER || demotingSuperAdmin) {
    admin.moduleAccess = normalizeModuleAccess(patch.moduleAccess, nextRole);
  }

  /*
  Permissions role ke saath rehta hai: sub admin ke liye scope ke andar,
  baaki roles ke liye khaali (SuperAdmin ko computed poori list milti hai).
  Purane sub-admin documents me permissions khaali ho sakti hain — tab default
  review loop lagta hai, warna har edit 400 deta.
  */
  if (nextRole === ROLE.SUPER) {
    admin.permissions = ADMIN_PERMISSION_KEYS;
  } else if (nextRole === ROLE.SUB) {
    const current = normalizePermissions(admin.permissions);
    const source =
      patch.permissions === undefined
        ? current.length
          ? current
          : undefined
        : patch.permissions;
    admin.permissions = resolvePermissions(source, nextRole, {
      loanAccess: admin.loanAccess,
      moduleAccess: admin.moduleAccess,
    });
  } else {
    admin.permissions = [];
  }

  await admin.save();
  return toPublic(admin);
};

/*
==========================================
Set a new password for an admin.

Pehle actor (jo super admin sign-in hai) ka apna current password verify hota
hai — bina purane password ke naya password set nahi hoga. Wrong password par
400 jaata hai (401 nahi), warna frontend ka interceptor session ko logout kar deta.
==========================================
*/
const resetAdminPassword = async (id, password, actorId, currentPassword) => {
  assertPassword(password);

  if (!String(currentPassword ?? "").trim()) {
    throw badRequest("Enter your current password to set a new password");
  }

  const actor = await Admin.findById(actorId).select("+password");
  if (!actor) throw fail(401, "Your session has expired. Please sign in again.");

  const matches = await bcrypt.compare(String(currentPassword), actor.password);
  if (!matches) throw badRequest("Your current password is incorrect");

  const admin = await Admin.findById(id).select("+password");
  if (!admin) throw notFound();

  admin.password = await bcrypt.hash(String(password), 10);
  await admin.save();
};

/*
==========================================
Admin delete = us admin ka kaam bhi delete

`adminUpdates` entries record ke andar admin ka naam/id COPY karke rakhti hain
(denormalised), isliye admin document delete hone par uska thread har record par
pada reh jaata tha — team me wo admin nahi, par har loan par uske message.
Phir naya regular admin banane par purana thread dekh kar confusion hoti thi.

Isliye admin delete hote hi uske likhe hue updates sabhi 18 loan products,
customers aur franchises se nikal diye jaate hain, aur uski di hui pending
status recommendation bhi clear ho jaati hai. Baaki admins ka kaam (aur final
decisions, `kind: "status"`) waise hi rehta hai.
==========================================
*/
const purgeAdminTrail = async (adminId) => {
  const withTrail = [...Object.values(MODELS), User, Franchise];
  let removedFrom = 0;
  let clearedRecommendations = 0;

  for (const Model of withTrail) {
    const pulled = await Model.updateMany(
      { "adminUpdates.addedBy": adminId },
      { $pull: { adminUpdates: { addedBy: adminId } } }
    );
    removedFrom += pulled.modifiedCount;

    const cleared = await Model.updateMany(
      { "statusRecommendation.recommendedBy": adminId },
      { $set: { statusRecommendation: null } }
    );
    clearedRecommendations += cleared.modifiedCount;
  }

  return { removedFrom, clearedRecommendations };
};

const deleteAdmin = async (id, actorId) => {
  const admin = await Admin.findById(id);
  if (!admin) throw notFound();

  if (String(admin._id) === String(actorId)) {
    throw badRequest("You cannot delete the account you are signed in with");
  }

  if (admin.role === ROLE.SUPER && (await countOtherSuperAdmins(admin._id)) === 0) {
    throw badRequest("At least one super admin must remain");
  }

  /* Pehle trail saaf, phir admin — purge fail ho to account bacha rahe. */
  const purged = await purgeAdminTrail(admin._id);
  await Admin.deleteOne({ _id: admin._id });

  return purged;
};

module.exports = {
  ROLE,
  MAX_REGULAR_ADMINS,
  scopeOf,
  resolvePermissions,
  listAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
  deleteAdmin,
  purgeAdminTrail,
};
