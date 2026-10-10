const router = require("express").Router();

const adminAuth = require("../../middleware/adminAuth.middleware");

/*
========================================
Admin API Router
All admin-facing routes are namespaced under /api/admin
and kept isolated from the public/user-facing API.
========================================
*/

router.use("/auth", require("./adminAuth.routes"));

router.use("/", adminAuth, require("./application.routes"));

/*
Location Master owns its own relational collections (continents, countries,
states, cities, pincodes) and lives in src/modules/location. It must be
mounted BEFORE "/masters" so "/masters/location" is not swallowed by the
generic master routes.
*/
router.use("/masters/location", adminAuth, require("../location/location.routes"));

router.use("/masters", adminAuth, require("./master.routes"));

router.use("/customers", adminAuth, require("./customer.routes"));

router.use("/franchises", adminAuth, require("./franchise.routes"));

/*
Franchise investment plans — admin yahan fee / validity / renewal edit karta
hai, aur wahi data /franchise page par public GET /api/franchise/plans se
jaata hai. "/franchises" se alag prefix hai, isliye order ka issue nahi.
*/
router.use("/franchise-plans", adminAuth, require("./franchisePlan.routes"));

/* Franchise ke customers ka poora network view (read-only admin view). */
router.use("/franchise-customers", adminAuth, require("./franchiseCustomer.routes"));

module.exports = router;
