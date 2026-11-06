const router = require("express").Router();

const adminAuth = require("../../middleware/adminAuth.middleware");
const contactController = require("./contact.controller");

/*
==========================================
Admin contact routes — mounted at /api/admin/contacts

  GET    /       list enquiries (?status=&topic=&search=&page=&limit=)
  PATCH  /:id    { status?, note? }  — regular aur super admin dono
  DELETE /:id    spam / duplicate enquiry hatao

Delete par purposely super-admin gate nahi lagaya: admin panel ka axios
interceptor 403 par session clear kar deta hai, aur enquiry hatana aisa
kaam hai jo lead handle karne wala regular admin bhi karta hai.
==========================================
*/

router.use(adminAuth);

router.get("/", contactController.list);
router.patch("/:id", contactController.update);
router.delete("/:id", contactController.remove);

module.exports = router;
