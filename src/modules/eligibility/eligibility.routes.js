const router = require("express").Router();

const controller = require("./eligibility.controller");
const { eligibilityLimiter } = require("../../middleware/rateLimit.middleware");

/*
==========================================
Public eligibility API — mounted at /api/eligibility

  GET  /rate-card   product-wise ROI + max tenure (frontend dropdown/table)
  POST /check       calculator submit -> result + DB me save (ELG000001)

Website (indexia-finance-web) in dono ko call karta hai. Admin panel checks
/api/admin/eligibility-checks se padhta hai.

`/rate-card` `/check` se pehle hai — warna koi bhi static path `POST` se clash
nahi karta, par padhne me clear rehta hai.
==========================================
*/

router.get("/rate-card", controller.rateCard);
router.post("/check", eligibilityLimiter, controller.check);

module.exports = router;
