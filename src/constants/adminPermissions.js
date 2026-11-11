/*
==========================================
Admin roles + sub-admin permissions.

Role aur permission alag cheezein hain:

  SuperAdmin -> sab kuch (permission list ki zaroorat nahi)
  SubAdmin   -> sirf woh capabilities jo super admin ne tick ki hain
  Admin      -> regular admin; in permissions ka koi matlab nahi

Sub admin ka scope wahi hai jo regular admin ka access hota hai:
  Loan products            -> loanAccess (slugs)
  Customers & Franchises   -> moduleAccess (["customers","franchises"])
Isliye har permission ek `scope` declare karti hai. `loans.decide` sirf loan
scope me banti hai — customer/franchise record ka final decision us scope ka
kaam nahi hai.
==========================================
*/

const ADMIN_ROLE = {
  SUPER: "SuperAdmin",
  SUB: "SubAdmin",
  ADMIN: "Admin",
};

const ADMIN_ROLE_VALUES = Object.values(ADMIN_ROLE);

const ADMIN_ROLE_LABELS = {
  [ADMIN_ROLE.SUPER]: "Super admin",
  [ADMIN_ROLE.SUB]: "Sub admin",
  [ADMIN_ROLE.ADMIN]: "Admin",
};

const PERMISSION_SCOPE = {
  LOANS: "loans",
  MODULES: "modules",
  BOTH: "both",
};

/*
Capability catalogue. Keys frontend ke `src/constants/adminPermissions.ts` se
bilkul same hain — dono taraf ek hi string par gate lagta hai, isliye typo se
koi permission silently allow/deny nahi hoti.
*/
const ADMIN_PERMISSIONS = [
  {
    key: "updates.view",
    label: "View admin updates",
    scope: PERMISSION_SCOPE.BOTH,
  },
  {
    key: "updates.review",
    label: "Mark updates reviewed",
    scope: PERMISSION_SCOPE.BOTH,
  },
  {
    key: "updates.return",
    label: "Return work for correction",
    scope: PERMISSION_SCOPE.BOTH,
  },
  {
    key: "updates.escalate",
    label: "Escalate to super admin",
    scope: PERMISSION_SCOPE.BOTH,
  },
  {
    key: "admins.view",
    label: "View admin details",
    scope: PERMISSION_SCOPE.BOTH,
  },
  {
    /*
    Website contact form ki enquiries dekhna aur status/note update karna.
    Default me kisi ko nahi milti — super admin explicitly deta hai. Delete
    iske andar nahi hai, wo super admin ka hi kaam rehta hai.
    */
    key: "contacts.manage",
    label: "Handle contact enquiries",
    scope: PERMISSION_SCOPE.BOTH,
  },
  {
    key: "loans.decide",
    label: "Record final decision",
    scope: PERMISSION_SCOPE.LOANS,
  },
];

const ADMIN_PERMISSION_KEYS = ADMIN_PERMISSIONS.map((entry) => entry.key);

/* Naya sub admin default me sirf review loop karta hai — final decision off. */
const DEFAULT_SUB_ADMIN_PERMISSIONS = [
  "updates.view",
  "updates.review",
  "updates.return",
  "updates.escalate",
];

const permissionDef = (key) =>
  ADMIN_PERMISSIONS.find((entry) => entry.key === key) || null;

const isKnownPermission = (key) => Boolean(permissionDef(key));

const appliesToScope = (key, scope) => {
  const def = permissionDef(key);
  if (!def) return false;
  return def.scope === PERMISSION_SCOPE.BOTH || def.scope === scope;
};

const permissionsForScope = (scope) =>
  ADMIN_PERMISSIONS.filter((entry) => appliesToScope(entry.key, scope));

/** Dedupe + drop unknown keys; never widen access from a bad payload. */
const normalizePermissions = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.reduce((list, entry) => {
    const key = String(entry ?? "").trim();
    if (!key || seen.has(key) || !isKnownPermission(key)) return list;
    seen.add(key);
    list.push(key);
    return list;
  }, []);
};

const filterPermissionsForScope = (value, scope) =>
  normalizePermissions(value).filter((key) => appliesToScope(key, scope));

const isSubAdminRole = (role) => role === ADMIN_ROLE.SUB;
const isSuperAdminRole = (role) => role === ADMIN_ROLE.SUPER;

module.exports = {
  ADMIN_ROLE,
  ADMIN_ROLE_VALUES,
  ADMIN_ROLE_LABELS,
  PERMISSION_SCOPE,
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_KEYS,
  DEFAULT_SUB_ADMIN_PERMISSIONS,
  permissionDef,
  isKnownPermission,
  appliesToScope,
  permissionsForScope,
  normalizePermissions,
  filterPermissionsForScope,
  isSubAdminRole,
  isSuperAdminRole,
};
