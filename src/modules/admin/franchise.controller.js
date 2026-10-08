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

    const [franchises, total] = await Promise.all([
      franchiseService.listFranchises({ status, search, page, limit }),
      franchiseService.countFranchises({ status, search }),
    ]);
    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageLimit = Math.min(Math.max(Number(limit) || 0, 0), 100);

    res.json({
      success: true,
      franchises,
      total,
      page: pageNumber,
      limit: pageLimit,
      totalPages: pageLimit > 0 ? Math.max(1, Math.ceil(total / pageLimit)) : 1,
    });
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
    // How many loans this franchise has filed — a single call for the admin.
    const loanCount = await franchiseService.countFranchiseLoans(franchise._id);

    res.json({
      success: true,
      // Login ID + first password (the registered mobile) so the admin can re-share them later.
      // null until the application has been approved.
      credentials: franchiseService.buildCredentials(franchise),
      loanCount,
      franchise,
    });
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
      // Exactly what the admin has to pass on to the franchise partner.
      credentials: franchiseService.buildCredentials(franchise),
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
Reset the login password of an approved franchise to its registered mobile
(the current rule). Keeps the FRN code and approval status unchanged.
PATCH /api/admin/franchises/:id/reset-password
*/
exports.resetPassword = async (req, res, next) => {
  try {
    const franchise = await franchiseService.resetFranchisePassword(req.params.id);

    res.json({
      success: true,
      message: `Credentials reset. Login ID: ${franchise.franchiseId}`,
      credentials: franchiseService.buildCredentials(franchise),
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
