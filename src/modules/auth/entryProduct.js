/*
==========================================
Entry product vs apply product.

Entry (`POST /api/auth/:product`) ek hi loan product ke liye hoti hai: usme chuna
hua product OTP document par baithta hai (`otp.model.js`), aur verify hone par
wahi product token me chala jaata hai (`generateToken(account, { product })`).

Uske baad customer sirf USI product ka form bhar sakta hai. Warna ek product ke
liye verify hui identity kisi doosre product ki application bana deti hai —
personal loan ka token le kar home loan apply ho jaata tha.

Rule:
  - token ka product == apply ka product            -> allowed
  - token me product hi nahi (is change se pehle ka token)  -> rok, entry dobara
  - token ka product alag (personal token + home form)      -> rok, saaf message

Sirf customer tokens par lagta hai (`middleware/entryProduct.middleware.js`).
Franchise / franchise-customer doors apna product URL se lete hain aur unke
token me product hota hi nahi, isliye wo in dono par nahi rukta.
==========================================
*/

const { LOAN_PRODUCTS } = require("../loans/shared/loanProducts");

const cleanText = (value) => String(value ?? "").trim();

/** Screen/message me dikhane ka naam — "Home Loan" (key na ho to key hi). */
const productLabel = (key) => LOAN_PRODUCTS[key]?.loanType || cleanText(key) || "this loan";

/**
 * Token ke product aur apply ke product ko milata hai.
 *
 * Mismatch par `{ entryProduct, requestedProduct, message }` deta hai, warna
 * `null`. Unknown product yahan check nahi hota — us par product ka apna
 * validator saaf 400 de deta hai.
 */
const findEntryProductMismatch = (entryProduct, requestedProduct) => {
  const requested = cleanText(requestedProduct);
  if (!LOAN_PRODUCTS[requested]) return null;

  const entered = cleanText(entryProduct);
  if (entered === requested) return null;

  if (!entered) {
    return {
      entryProduct: "",
      requestedProduct: requested,
      message:
        `Your mobile is not verified for ${productLabel(requested)}. Please complete the ` +
        `${productLabel(requested)} entry (verify your mobile with the OTP) and then apply.`,
    };
  }

  return {
    entryProduct: entered,
    requestedProduct: requested,
    message:
      `Your token was issued for ${productLabel(entered)}. To apply for ` +
      `${productLabel(requested)}, please complete the ${productLabel(requested)} entry ` +
      `(verify your mobile with the OTP) and use that token.`,
  };
};

module.exports = { findEntryProductMismatch };
