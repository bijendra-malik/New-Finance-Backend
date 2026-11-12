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

/*
Ek sub admin ko dono areas mil sakte hain — loan products aur Customers /
Franchises. Tab permission tab valid hai jab wo chune hue kisi bhi area par
lagti ho. `both` wali permissions hamesha valid hain.
*/
const appliesToAnyScope = (key, scopes = []) => {
  const def = permissionDef(key);
  if (!def || !Array.isArray(scopes) || scopes.length === 0) return false;
  return def.scope === PERMISSION_SCOPE.BOTH || scopes.includes(def.scope);
};

const filterPermissionsForScopes = (value, scopes) =>
  normalizePermissions(value).filter((key) => appliesToAnyScope(key, scopes));

const isSubAdminRole = (role) => role === ADMIN_ROLE.SUB;
const isSuperAdminRole = (role) => role === ADMIN_ROLE.SUPER;

module.exports = {
  ADMIN_ROLE,
  PERMISSION_SCOPE,
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_KEYS,
  DEFAULT_SUB_ADMIN_PERMISSIONS,
  permissionDef,
  appliesToScope,
  appliesToAnyScope,
  normalizePermissions,
  filterPermissionsForScopes,
  isSubAdminRole,
  isSuperAdminRole,
};
