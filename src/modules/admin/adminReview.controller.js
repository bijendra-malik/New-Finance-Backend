const adminReviewService = require("./adminReview.service");

/*
==========================================
Sub-admin review API — /api/admin/reviews

  GET    /            -> { success, total, reviews }
  GET    /summary     -> { success, summary: { windowDays, total, counts } }
  POST   /            -> save/overwrite one review (permission per action)
  DELETE /:key        -> clear a review (updates.review)

Route-level guard sirf padhne ke liye hai; likhne ki permission action ke
hisaab se service check karti hai (verify/return/escalate/decide).
==========================================
*/

exports.list = async (req, res, next) => {
  try {
    const result = await adminReviewService.listReviews(req.admin, req.query ?? {});

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.summary = async (req, res, next) => {
  try {
    const summary = await adminReviewService.summary(req.admin, req.query ?? {});

    res.json({ success: true, summary });
  } catch (error) {
    next(error);
  }
};

exports.save = async (req, res, next) => {
  try {
    const review = await adminReviewService.saveReview(req.admin, req.body ?? {});

    res.json({
      success: true,
      message: "Review saved",
      review,
    });
  } catch (error) {
    next(error);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const cleared = await adminReviewService.clearReview(req.admin, req.params.key);

    res.json({
      success: true,
      message: "Review cleared",
      ...cleared,
    });
  } catch (error) {
    next(error);
  }
};
