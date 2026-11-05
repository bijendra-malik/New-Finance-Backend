const router = require("express").Router();

const customerController = require("./customer.controller");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");

router.get("/", customerController.list);
router.get("/:id", customerController.getOne);
router.get("/:id/applications", requireSuperAdmin, customerController.listApplications);
router.patch("/:id/status", requireSuperAdmin, customerController.setStatus);
/* Regular admin likhta hai; super admin ko yahan 403 milta hai. */
router.post("/:id/updates", customerController.addUpdate);
router.delete("/:id", customerController.remove);

module.exports = router;
