const User = require("../modules/auth/user.model");
const {
  findEntryDetailMismatch,
  ACCOUNT_NOT_FOUND_MESSAGE,
} = require("../modules/auth/entryDetails");

/**
 * Loan form ki identity details entry par verify hui details se match karata hai
 * (rule `modules/auth/entryDetails.js` me hai). Mismatch par 400, warna body me
 * verified values bhar kar aage badh jaata hai.
 *
 * Unified door (`POST /api/customer/loan-apply`) par lagta hai; per-product
 * routes (`POST /api/<product>/apply`) wahi check controller ke andar chalate hain.
 */
module.exports = async (req, res, next) => {
  try {
    const account = await User.findById(req.user.id);

    if (!account) {
      return res.status(401).json({ success: false, message: ACCOUNT_NOT_FOUND_MESSAGE });
    }

    const mismatch = findEntryDetailMismatch(account, req.body);

    if (mismatch) {
      return res.status(400).json({ success: false, message: mismatch.message });
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
