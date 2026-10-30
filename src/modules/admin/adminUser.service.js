const bcrypt = require("bcryptjs");
const Admin = require("./admin.model");
const { isValidEmail } = require("../../utils/validators");
const { LOAN_TYPE_SLUGS, LOAN_ACCESS_ALL } = require("../../constants/loanTypes");

/*
==========================================
Admin team management.

Super admin yahan se naye admin bana sakta hai, unka role badal sakta hai aur
tay kar sakta hai kaun kaun se loan products wo admin kholega (`loanAccess`).

Rules jo service khud enforce karta hai (frontend par bharosa nahi):
  - sirf ek SuperAdmin hi in routes tak pahunchta hai (middleware),
  - khud ka super admin role hataya nahi ja sakta,
  - aakhri super admin delete/demote nahi ho sakta,
  - khud ko delete nahi kiya ja sakta.
==========================================
*/

const ROLE = {
  SUPER: "SuperAdmin",
  ADMIN: "Admin",
};

const LOGIN_ID_REGEX = /^[a-z0-9][a-z0-9._-]{2,23}$/i;
const MIN_PASSWORD_LENGTH = 6;

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
  if (/^admin$/i.test(raw)) return ROLE.ADMIN;
  throw badRequest("Role must be Admin or SuperAdmin");
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
    loanAccess: doc.role === ROLE.SUPER ? LOAN_ACCESS_ALL : doc.loanAccess ?? [],
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

const createAdmin = async ({ loginId, name, email, password, role, loanAccess }) => {
  const cleanName = String(name ?? "").trim();
  if (cleanName.length < 2) throw badRequest("Name is required");
  if (cleanName.length > 100) throw badRequest("Name is too long (max 100 characters)");

  assertPassword(password);

  const cleanEmail = await assertEmail(email);
  const cleanRole = normalizeRole(role);
  const cleanLoginId = await assertLoginId(
    String(loginId ?? "").trim() || deriveLoginId(cleanEmail)
  );
  const access = normalizeLoanAccess(loanAccess, cleanRole);

  const admin = await Admin.create({
    name: cleanName,
    email: cleanEmail,
    loginId: cleanLoginId,
    password: await bcrypt.hash(String(password), 10),
    role: cleanRole,
    loanAccess: access,
  });

  return toPublic(admin);
};

const updateAdmin = async (id, patch = {}, actorId) => {
  const admin = await Admin.findById(id);
  if (!admin) throw notFound();

  const isSelf = String(admin._id) === String(actorId);
  const nextRole = normalizeRole(patch.role, admin.role);

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

const deleteAdmin = async (id, actorId) => {
  const admin = await Admin.findById(id);
  if (!admin) throw notFound();

  if (String(admin._id) === String(actorId)) {
    throw badRequest("You cannot delete the account you are signed in with");
  }

  if (admin.role === ROLE.SUPER && (await countOtherSuperAdmins(admin._id)) === 0) {
    throw badRequest("At least one super admin must remain");
  }

  await Admin.deleteOne({ _id: admin._id });
};

module.exports = {
  ROLE,
  listAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
  deleteAdmin,
};
