const { buildApplyValidator } = require("./loanValidator");
const { LOAN_PRODUCTS } = require("./loanProducts");

/*
==========================================
Product-dispatched apply validator.

Per-product routes know their product at route-definition time. The unified
entry points must instead pick the matching rules AT REQUEST TIME:

  POST /api/customer/loan-apply                  -> `product` in the BODY
  POST /api/franchise/customer/:product/applyloan -> `product` in the PATH
     (`productFromParam` pins it onto the body, then the same dispatcher runs)

The loan payload itself is identical to the per-product APIs — only the entry
point and the recorded channel differ.
==========================================
*/

const productValidators = Object.fromEntries(
  Object.keys(LOAN_PRODUCTS).map((product) => [product, buildApplyValidator(product)])
);

const productListMessage = () =>
  `A valid loan product is required (one of: ${Object.keys(LOAN_PRODUCTS).join(", ")})`;

/* Runs an express-validator chain array sequentially (chain = middlewares). */
const runChain = (chain) => (req, res, next) => {
  let index = 0;
  const step = (error) => {
    if (error) return next(error);
    if (index >= chain.length) return next();
    const middleware = chain[index++];
    middleware(req, res, step);
  };
  step();
};

/** Reads `product` from the body (or body.data) and runs that product's rules. */
const buildProductApplyValidator = () => (req, res, next) => {
  const product = String(req.body?.product ?? req.body?.data?.product ?? "").trim();
  const chain = productValidators[product];

  if (!chain) {
    return res.status(400).json({ success: false, message: productListMessage() });
  }

  return runChain(chain)(req, res, next);
};

/*
Maps a URL segment onto a LOAN_PRODUCTS key, so a product can also be named in
the path instead of the body:

  /customer/personal/applyloan          /customer/personalloan/applyloan
  /customer/personal-loan/applyloan     /customer/gold-loan/applyloan
  /customer/loan-against-property/applyloan   /customer/credit-card/applyloan

every one of those resolves to its config key ("personal", "goldLoan",
"lap", "creditCard", ...). Keys, keys + "loan", and the product's human
loanType are all accepted.
*/
const normalizeSegment = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const PRODUCT_ALIASES = (() => {
  const map = new Map();

  Object.entries(LOAN_PRODUCTS).forEach(([key, config]) => {
    [normalizeSegment(key), normalizeSegment(config.loanType)].forEach((base) => {
      if (!base) return;
      map.set(base, key);
      map.set(`${base}loan`, key);
      map.set(`${base}loans`, key);
    });
  });

  return map;
})();

const productKeyFromParam = (raw) => PRODUCT_ALIASES.get(normalizeSegment(raw)) || null;

/** Express middleware: pins the product taken from `:product` onto the body. */
const productFromParam = (req, res, next) => {
  const key = productKeyFromParam(req.params.product);

  if (!key) {
    return res.status(400).json({ success: false, message: productListMessage() });
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) req.body = {};
  req.body.product = key;

  return next();
};

module.exports = {
  buildProductApplyValidator,
  productValidators,
  productKeyFromParam,
  productFromParam,
};
