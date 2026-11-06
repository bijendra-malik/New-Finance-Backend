const router = require("express").Router();

const adminAuth = require("../../middleware/adminAuth.middleware");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");
const { requireModuleAccess } = require("./adminLoanAccess");

/*
========================================
Admin API Router
All admin-facing routes are namespaced under /api/admin
and kept isolated from the public/user-facing API.
========================================
*/

router.use("/auth", require("./adminAuth.routes"));

/*
Admin team (super admin only) — naye admin logins + unka loan access.
"/" wale application router se PEHLE mount hota hai, warna "/admins"
wahan 404 ho jata.
*/
router.use("/admins", require("./adminUser.routes"));

/*
Admin activity feed (super admin only) — har loan product ke adminUpdates
ko ek jagah jodta hai: kis admin ne kis loan par kya update kiya.
"/" wale application router se pehle mount hota hai, warna "/activity"
wahin 404 ho jata.
*/
router.use("/activity", require("./adminActivity.routes"));

/*
Website contact form ki enquiries (GET list, PATCH status/note, DELETE).
"/" wale application router se pehle mount hota hai, warna "/contacts" wahan
404 ho jata.
*/
router.use("/contacts", require("../contact/contact.admin.routes"));

router.use("/", adminAuth, require("./application.routes"));

/*
Location Master owns its own relational collections (continents, countries,
states, cities, pincodes) and lives in src/modules/location. It must be
mounted BEFORE "/masters" so "/masters/location" is not swallowed by the
generic master routes.
*/
router.use("/masters/location", adminAuth, require("../location/location.routes"));

router.use("/masters", adminAuth, require("./master.routes"));

router.use("/customers", adminAuth, requireModuleAccess("customers"), require("./customer.routes"));

router.use("/franchises", adminAuth, requireModuleAccess("franchises"), require("./franchise.routes"));

/*
Franchise investment plans — admin yahan fee / validity / renewal edit karta
hai, aur wahi data /franchise page par public GET /api/franchise/plans se
jaata hai. "/franchises" se alag prefix hai, isliye order ka issue nahi.
*/
router.use("/franchise-plans", adminAuth, requireSuperAdmin, require("./franchisePlan.routes"));

/* Franchise ke customers ka pooro network view (read-only admin view). */
router.use("/franchise-customers", adminAuth, requireSuperAdmin, require("./franchiseCustomer.routes"));

module.exports = router;
