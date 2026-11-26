const service = require("./eligibility.service");

/*
==========================================
Eligibility controllers

Public : GET /api/eligibility/rate-card
         POST /api/eligibility/check
         POST /api/eligibility/calculator/:slug
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
Ek hi check pipeline: /check product body se leta hai, /calculator/:slug path se.
Handler 3-arg hi rehta hai — express 4-arg function ko error middleware samajhta hai.
*/
const checkFor = (productKey) => async (req, res, next) => {
  try {
    const { check, duplicate } = await service.createEligibilityCheck(req.body, productKey);

    /*
    Response sirf check row hai — koi wrapper, product block, outcome snapshot
    ya duplicate headline/caps nahi. Jo field response me chahiye wo toCheckView
    me add karo, yahan nahi. Naya check 201, duplicate 200.
    */
    res.status(duplicate ? 200 : 201).json(check);
  } catch (error) {
    if (error.statusCode === 400 && error.errors) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: error.message,
        errors: error.errors,
      });
    }
    next(error);
  }
};

/*
Check eligibility (public) — POST /api/eligibility/check
Body website ke form jaisi flat hai — product key ("personal"), dob,
monthlyIncome, creditScore, existingEmi, aur product-specific fields.
*/
exports.check = checkFor();

/*
Product-scoped check — POST /api/eligibility/calculator/personal-loan
Body wahi flat form body; product path se aata hai, body ka product ignore hota hai.
*/
exports.checkProduct = checkFor;

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

/*
Single check (super admin)
GET /api/admin/eligibility-checks/:id
Admin drawer isko call karta hai — list row ka latest version.
*/
exports.getOne = async (req, res, next) => {
  try {
    res.json({ success: true, check: await service.getEligibilityCheck(req.params.id) });
  } catch (error) {
    next(error);
  }
};

/*
Delete check (super admin)
DELETE /api/admin/eligibility-checks/:id
Permanent hai — deleted row wapas nahi aata aur uska checkNo bhi release nahi
hota (sequence aage hi badhta hai). Panel delete ke baad list khud refresh
karta hai, isliye deleted row wapas nahi bhejte.
*/
exports.remove = async (req, res, next) => {
  try {
    await service.deleteEligibilityCheck(req.params.id);

    res.json({ success: true, message: "Eligibility check deleted successfully" });
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
