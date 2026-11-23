const service = require("./eligibility.service");

/*
==========================================
Eligibility controllers

Public : GET /api/eligibility/rate-card, POST /api/eligibility/check
Admin  : /api/admin/eligibility-checks (list, stats)
==========================================
*/

/* Rate card (public) — product-wise ROI + max tenure. */
exports.rateCard = async (req, res, next) => {
  try {
    res.json({ success: true, products: service.rateCard() });
  } catch (error) {
    next(error);
  }
};

/*
Check eligibility (public)
POST /api/eligibility/check
{
  name, mobile, email?, dob: "DD/MM/YYYY" (ya dobDD/dobMM/dobYYYY),
  country, occupation, product, monthlyIncome, existingEmi?
}
*/
exports.check = async (req, res, next) => {
  try {
    const { check, duplicate } = await service.createEligibilityCheck(req.body);

    res.status(duplicate ? 200 : 201).json({
      success: true,
      duplicate,
      checkNo: check.checkNo,
      checkedAt: check.checkedAt,
      result: check,
    });
  } catch (error) {
    next(error);
  }
};

/*
List checks (super admin)
GET /api/admin/eligibility-checks
    ?search=&product=&eligible=yes|no&from=&to=&page=&limit=
*/
exports.list = async (req, res, next) => {
  try {
    const result = await service.listEligibilityChecks(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/* Dashboard cards + product breakdown (super admin) */
exports.stats = async (req, res, next) => {
  try {
    res.json({ success: true, stats: await service.eligibilityCheckStats() });
  } catch (error) {
    next(error);
  }
};
