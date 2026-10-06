const { buildApplyValidator } = require("./loanValidator");
const { LOAN_PRODUCTS } = require("./loanProducts");

/*
==========================================
Product-dispatched apply validator.

The per-product routes know their product at route-definition time, but the
unified entry points (POST /api/customer/loan-apply and
POST /api/franchise/loan-apply) receive `product` in the body and must pick the
matching rules AT REQUEST TIME.

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

module.exports = { buildProductApplyValidator, productValidators };
