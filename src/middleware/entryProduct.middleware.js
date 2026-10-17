const { findEntryProductMismatch } = require("../modules/auth/entryProduct");
const { USER_ROLE } = require("../constants/roles");

/*
==========================================
Apply door ka product-scope guard.

`requireEntryProduct("home")` sirf tab aage badhne deta hai jab token usi product
ke entry se bana ho. Rule `modules/auth/entryProduct.js` me hai.

Kaun rukta hai: sirf customer token (role `Customer` / legacy `User`).
Franchise aur franchise-customer doors apna product URL se lete hain aur unke
token me product hota hi nahi, isliye wo yahan skip ho jaate hain.
==========================================
*/

const CUSTOMER_ROLES = [USER_ROLE.CUSTOMER, USER_ROLE.LEGACY_CUSTOMER];

/** `productKey` — ek product key ("home") ya `(req) => key` (body wala door). */
const requireEntryProduct = (productKey) => (req, res, next) => {
  if (!CUSTOMER_ROLES.includes(req.user?.role)) return next();

  /*
  Login token kisi product ki entry se nahi banta — customer phone OTP login
  ke baad credit score check karke koi bhi loan choose kar sakta hai. Entry
  token par product lock hamesha lagta rahega.
  */
  if (req.user?.login) return next();

  const requestedProduct =
    typeof productKey === "function" ? productKey(req) : productKey;

  const mismatch = findEntryProductMismatch(req.user?.product, requestedProduct);

  if (mismatch) {
    return res.status(403).json({
      success: false,
      message: mismatch.message,
      entryProduct: mismatch.entryProduct,
      requestedProduct: mismatch.requestedProduct,
    });
  }

  return next();
};

module.exports = requireEntryProduct;
