const router = require("express").Router();

const franchisePlanController = require("./franchisePlan.controller");
const {
  createPlanValidator,
  updatePlanValidator,
  setBestValueValidator,
  setStatusValidator,
} = require("../franchise/franchisePlan.validator");

/*
==========================================
Admin franchise plan routes — mounted at /api/admin/franchise-plans
(admin auth is applied by the parent router in src/modules/admin/index.js)

  GET    /                       list plans (?active=true|false)
  POST   /                       create a plan
  GET    /:id                    one plan
  PATCH  /:id                    edit fee / validity / renewal / features / order
  PATCH  /:id/best-value         pin or unpin the "Best Value" badge
  PATCH  /:id/status             { isActive } show / hide on the franchise page
  DELETE /:id                    soft delete (plan is deactivated, not erased)

Ye endpoints /franchise page ke "Plans & fees" section ko chalate hain, aur
yahi plan apply ke waqt franchise record par snapshot hota hai.
==========================================
*/

router.get("/", franchisePlanController.list);
router.post("/", createPlanValidator, franchisePlanController.create);

router.get("/:id", franchisePlanController.getOne);
router.patch("/:id", updatePlanValidator, franchisePlanController.update);
router.patch("/:id/best-value", setBestValueValidator, franchisePlanController.setBestValue);
router.patch("/:id/status", setStatusValidator, franchisePlanController.setStatus);
router.delete("/:id", franchisePlanController.remove);

module.exports = router;
