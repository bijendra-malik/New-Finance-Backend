const service = require("./franchiseCustomer.service");

/*
==========================================
Admin franchise-customer controllers (read-only).
==========================================
*/

/*
List Franchise Customers (sare franchises, unka CIBIL state)
GET /api/admin/franchise-customers
    ?search=&franchise=&cibilStatus=&locked=&page=&limit=

  franchise     -> FRN code (FRN000001) ya franchise id
  cibilStatus   -> NotChecked | Checked | Failed
  locked        -> true | false (derived eligibility state)
*/
exports.list = async (req, res, next) => {
  try {
    const { search, franchise, cibilStatus, locked, page, limit } = req.query;

    const [customers, total] = await Promise.all([
      service.listFranchiseCustomers({ search, franchise, cibilStatus, locked, page, limit }),
      service.countFranchiseCustomers({ search, franchise, cibilStatus, locked }),
    ]);

    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageLimit = Math.min(Math.max(Number(limit) || 0, 0), 100);

    res.json({
      success: true,
      customers,
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
Network-wide CIBIL funnel (franchise-wise)
GET /api/admin/franchise-customers/stats
*/
exports.stats = async (req, res, next) => {
  try {
    res.json({ success: true, stats: await service.franchiseCibilStats() });
  } catch (error) {
    next(error);
  }
};

/*
One franchise customer — CIBIL data + owner franchise + uske loans ka status view
GET /api/admin/franchise-customers/:id
*/
exports.getOne = async (req, res, next) => {
  try {
    const { customer, franchise, loans } = await service.getFranchiseCustomer(req.params.id);

    res.json({ success: true, customer, franchise, loans });
  } catch (error) {
    next(error);
  }
};
