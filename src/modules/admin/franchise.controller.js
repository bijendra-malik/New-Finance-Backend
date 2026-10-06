const franchiseService = require("./franchise.service");

/*
==========================================
Admin franchise controllers.
==========================================
*/

/*
List Franchise Applications
GET /api/admin/franchises?status=&search=&page=&limit=
*/
exports.list = async (req, res, next) => {
  try {
    const { status, search, page, limit } = req.query;

    const franchises = await franchiseService.listFranchises({ status, search, page, limit });

    res.json({ success: true, franchises });
  } catch (error) {
    next(error);
  }
};

/*
Get One Franchise Application
GET /api/admin/franchises/:id
*/
exports.getOne = async (req, res, next) => {
  try {
    const franchise = await franchiseService.getFranchiseById(req.params.id);
    res.json({ success: true, franchise });
  } catch (error) {
    next(error);
  }
};

/*
Approve Franchise   (mints the FRN code + the PAN password)
PATCH /api/admin/franchises/:id/approve
*/
exports.approve = async (req, res, next) => {
  try {
    const franchise = await franchiseService.approveFranchise(req.params.id);

    res.json({
      success: true,
      message: `Franchise approved. Login ID: ${franchise.franchiseId}`,
      franchise,
    });
  } catch (error) {
    next(error);
  }
};

/*
Reject Franchise
PATCH /api/admin/franchises/:id/reject   { note? }
*/
exports.reject = async (req, res, next) => {
  try {
    const { note } = req.body ?? {};
    const franchise = await franchiseService.rejectFranchise(req.params.id, note);

    res.json({
      success: true,
      message: "Franchise application rejected",
      franchise,
    });
  } catch (error) {
    next(error);
  }
};

/*
Loans submitted through one franchise (tracking)
GET /api/admin/franchises/:id/loans
*/
exports.loans = async (req, res, next) => {
  try {
    const result = await franchiseService.listFranchiseLoans(req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};
