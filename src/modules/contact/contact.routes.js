const router = require("express").Router();

const contactController = require("./contact.controller");
const { contactLimiter } = require("../../middleware/rateLimit.middleware");

/*
==========================================
Public contact API — mounted at /api/contact

  POST /   website ka "Send an enquiry" form (koi auth nahi, isliye rate limit)

Website (indexia-finance-web) isi endpoint par POST karega. Admin panel
enquiries /api/admin/contacts se padhta hai (contact.admin.routes.js).
==========================================
*/

router.post("/", contactLimiter, contactController.create);

module.exports = router;
