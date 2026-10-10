const franchisePlanService = require("../franchise/franchisePlan.service");

/*
==========================================
Admin franchise plan controllers — /api/admin/franchise-plans
(admin auth parent router lagata hai: src/modules/admin/index.js)

Yahi API admin panel chalata hai jisse /franchise page ka
"Plans & fees" section update hota hai.
==========================================
*/

/*
List Plans (inactive bhi)
GET /api/admin/franchise-plans?active=true|false
*/
exports.list = async (req, res, next) => {
  try {
    const { plans, bestValueCode, bestValueIsPinned } = await franchisePlanService.listAdminPlans({
      active: req.query.active,
    });

    res.json({
      success: true,
      count: plans.length,
      bestValueCode,
      bestValueIsPinned,
      plans,
    });
  } catch (error) {
    next(error);
  }
};

/*
Get One Plan
GET /api/admin/franchise-plans/:id
*/
exports.getOne = async (req, res, next) => {
  try {
    const plan = await franchisePlanService.getPlanById(req.params.id);

    res.json({
      success: true,
      plan: franchisePlanService.withDerivedFields(plan),
    });
  } catch (error) {
    next(error);
  }
};

/*
Create Plan
POST /api/admin/franchise-plans
*/
exports.create = async (req, res, next) => {
  try {
    const plan = await franchisePlanService.createPlan(req.body, req.admin?.id);

    res.status(201).json({
      success: true,
      message: `Plan "${plan.name}" created successfully`,
      plan,
    });
  } catch (error) {
    next(error);
  }
};

/*
Update Plan (fee / validity / renewal / features / order)
PATCH /api/admin/franchise-plans/:id
*/
exports.update = async (req, res, next) => {
  try {
    const plan = await franchisePlanService.updatePlan(req.params.id, req.body, req.admin?.id);

    res.json({
      success: true,
      message: `Plan "${plan.name}" updated successfully`,
      plan,
    });
  } catch (error) {
    next(error);
  }
};

/*
Pin / Unpin the "Best Value" badge
PATCH /api/admin/franchise-plans/:id/best-value   { isBestValue?: true }
Sirf ek plan par badge rehta hai — pin karte hi baaki sab se hat jaata hai.
*/
exports.setBestValue = async (req, res, next) => {
  try {
    const isBestValue = req.body?.isBestValue;
    const plan = await franchisePlanService.setBestValue(
      req.params.id,
      isBestValue === undefined ? true : isBestValue,
      req.admin?.id
    );

    res.json({
      success: true,
      message: plan.isBestValue
        ? `"${plan.name}" is now the Best Value plan`
        : `Best Value badge removed from "${plan.name}"`,
      plan,
    });
  } catch (error) {
    next(error);
  }
};

/*
Activate / Deactivate a plan
PATCH /api/admin/franchise-plans/:id/status   { isActive: true|false }

Deactivate karne par plan public list se hatega, delete nahi hoga — purane
franchise records us plan ka snapshot rakhte hain.
*/
exports.setStatus = async (req, res, next) => {
  try {
    const plan = await franchisePlanService.setPlanStatus(
      req.params.id,
      req.body?.isActive,
      req.admin?.id
    );

    res.json({
      success: true,
      message: plan.isActive
        ? `Plan "${plan.name}" is now live on the franchise page`
        : `Plan "${plan.name}" is now hidden from the franchise page`,
      plan,
    });
  } catch (error) {
    next(error);
  }
};

/*
Remove Plan (soft delete)
DELETE /api/admin/franchise-plans/:id
*/
exports.remove = async (req, res, next) => {
  try {
    const plan = await franchisePlanService.removePlan(req.params.id, req.admin?.id);

    res.json({
      success: true,
      message: `Plan "${plan.name}" is now inactive and hidden from the franchise page`,
      plan,
    });
  } catch (error) {
    next(error);
  }
};
