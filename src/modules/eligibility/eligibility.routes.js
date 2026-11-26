const router = require("express").Router();

const controller = require("./eligibility.controller");
const { PRODUCTS } = require("./engine/core");
const { productSlug } = require("./eligibility.input");
const { eligibilityLimiter } = require("../../middleware/rateLimit.middleware");

/*
==========================================
Public eligibility API — mounted at /api/eligibility

  GET  /rate-card          13 products: ROI, max tenure, min loan, formula
  POST /check              flat form body + `product`
  POST /calculator/:slug   product-scoped; body me `product` ki zaroorat nahi

Scoped URL website ke page URL jaise hi hai:
/calculator/personal-loan, /calculator/home-loan, /calculator/od-cc-limit...
Slug `productSlug(product.key)` se banta hai, isliye product list badalne par
route khud badal jaata hai. Body dono routes par same flat form body hai aur
scoped route par path ka product hi final hota hai.
==========================================
*/

router.get("/rate-card", controller.rateCard);
router.post("/check", eligibilityLimiter, controller.check);

/* Ek hi handler, har product ka apna URL — PRODUCTS hi single source hai. */
for (const product of PRODUCTS) {
  router.post(
    `/calculator/${productSlug(product.key)}`,
    eligibilityLimiter,
    controller.checkProduct(product.key),
  );
}

module.exports = router;
