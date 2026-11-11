const router = require("express").Router();

const adminAuth = require("../../middleware/adminAuth.middleware");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");
const { requirePermission } = require("../admin/adminLoanAccess");
const contactController = require("./contact.controller");

/*
==========================================
Admin contact routes — mounted at /api/admin/contacts

  GET    /       list enquiries (?status=&topic=&search=&page=&limit=)
  PATCH  /:id    { status?, note? }
  DELETE /:id    spam / duplicate enquiry hatao

Access ab role se nahi, permission se decide hota hai:

  - SuperAdmin ke paas har permission hoti hai, isliye wo hamesha allowed.
  - SubAdmin ko super admin `contacts.manage` de sakta hai (Team & Access).
  - Regular Admin ke paas permissions hoti hi nahi -> 403.

Delete destructive hai, isliye wo permission ke baad bhi super-admin-only
rehta hai — enquiry handle karna aur permanent delete karna alag cheezein hain.
==========================================
*/

router.use(adminAuth, requirePermission("contacts.manage"));

router.get("/", contactController.list);
router.patch("/:id", contactController.update);
router.delete("/:id", requireSuperAdmin, contactController.remove);

module.exports = router;
