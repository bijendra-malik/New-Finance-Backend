const mongoose = require("mongoose");

const FranchiseCustomer = require("../franchise/franchiseCustomer.model");
const FranchiseCustomerLoanDraft = require("../franchise/franchiseCustomerLoanDraft.model");
const Franchise = require("../franchise/franchise.model");
const { MODELS } = require("../loans/shared/loanModels");
const { RESOURCE_ROUTES } = require("../loans/shared/adminStatus.service");
const {
  serializeCustomer,
  listCustomerLoans,
} = require("../franchise/franchiseCustomer.service");

/*
==========================================
Admin view: franchise ke customers.

Franchise apne customers ko apni hi screen par dekhta hai; admin ko poore network
ka view chahiye:

  listFranchiseCustomers   GET /api/admin/franchise-customers
                           (?search=&franchise=&page=&limit=)
  franchiseCustomerStats   GET /api/admin/franchise-customers/stats
  getFranchiseCustomer     GET /api/admin/franchise-customers/:id

List/detail wahi customer shape deta hai jo franchise ko milta hai, upar owner
franchise ka naam/FRN code aur har customer ke loans ka count. Admin read-only
hai — yahan se na customer banta hai na loan file hota hai.
==========================================
*/

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const notFound = (message) => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

const clean = (value) => String(value ?? "").trim();
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/*
`franchise` query param: FRN code (FRN000001) ya franchise ObjectId — dono
chalte hain taaki list screen dono jagah se filter kare.
*/
const applyOwnerFilter = (filter, value) => {
  const owner = clean(value);
  if (!owner) return;

  if (/^FRN/i.test(owner)) {
    // Stored code hamesha uppercase hota hai; input chhota bada dono chale.
    filter.franchiseCode = new RegExp(`^${escapeRegex(owner.toUpperCase())}$`, "i");
  } else if (mongoose.isValidObjectId(owner)) {
    filter.franchise = owner;
  } else {
    throw badRequest("franchise must be an FRN code (e.g. FRN000001) or a franchise id");
  }
};

const buildFilter = ({ search, franchise } = {}) => {
  const filter = {};

  applyOwnerFilter(filter, franchise);

  const q = clean(search);
  if (q) {
    const regex = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ fullName: regex }, { mobile: regex }, { panNumber: regex }, { email: regex }];
  }

  return filter;
};

/* ------------------------------------------------------------- loans -- */

/*
Har customer ke loans ka count + last apply date (product-wise aggregate).
Franchise-side helper `franchise: <id>` par scoped tha; admin ke list me poore
network ke rows aate hain, isliye yahan sirf `franchiseCustomer` par group
hota hai.
*/
const attachLoanCounts = async (rows) => {
  if (!rows.length) return rows;

  const aggregates = await Promise.all(
    Object.values(RESOURCE_ROUTES).map((entry) =>
      MODELS[entry.productKey].aggregate([
        { $match: { franchiseCustomer: { $in: rows.map((row) => row._id) } } },
        {
          $group: {
            _id: "$franchiseCustomer",
            count: { $sum: 1 },
            lastAppliedAt: { $max: "$createdAt" },
          },
        },
      ])
    )
  );

  const byCustomer = new Map();
  aggregates.flat().forEach((row) => {
    if (!row?._id) return;
    const key = String(row._id);
    const current = byCustomer.get(key) || { count: 0, lastAppliedAt: null };
    const lastAppliedAt =
      current.lastAppliedAt && new Date(current.lastAppliedAt) > new Date(row.lastAppliedAt)
        ? current.lastAppliedAt
        : row.lastAppliedAt;

    byCustomer.set(key, { count: current.count + row.count, lastAppliedAt });
  });

  return rows.map((row) => ({
    ...row,
    loans: byCustomer.get(String(row._id)) || { count: 0, lastAppliedAt: null },
  }));
};

/* Har row ke saath owner franchise ka naam + FRN code (list screen ka column). */
const attachFranchiseInfo = async (rows) => {
  if (!rows.length) return rows;

  const ids = [...new Set(rows.map((row) => String(row.franchise)))].filter(Boolean);
  if (!ids.length) return rows.map((row) => ({ ...row, franchise: null }));

  const franchises = await Franchise.find({ _id: { $in: ids } }).select(
    "name franchiseId franchiseStatus"
  );
  const byId = new Map(franchises.map((franchise) => [String(franchise._id), franchise]));

  return rows.map((row) => {
    const owner = byId.get(String(row.franchise));
    return {
      ...row,
      franchise: owner
        ? {
            _id: owner._id,
            name: owner.name,
            franchiseId: owner.franchiseId,
            franchiseStatus: owner.franchiseStatus,
          }
        : null,
    };
  });
};

const pageArgs = ({ page, limit } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 0), 100) || 0;
  const pageNumber = Math.max(Number(page) || 1, 1);
  return { safeLimit, pageNumber };
};

/* --------------------------------------------------------------- read -- */

const listFranchiseCustomers = async (query = {}) => {
  const filter = buildFilter(query);
  const { safeLimit, pageNumber } = pageArgs(query);

  const findQuery = FranchiseCustomer.find(filter).sort({ createdAt: -1 });
  if (safeLimit > 0) findQuery.skip((pageNumber - 1) * safeLimit).limit(safeLimit);

  const docs = await findQuery;
  const rows = docs.map(serializeCustomer);

  return attachLoanCounts(await attachFranchiseInfo(rows));
};

const countFranchiseCustomers = async (query = {}) =>
  FranchiseCustomer.countDocuments(buildFilter(query));

/*
Ek customer ka poora detail: customer, owner franchise ka summary, aur usi ke
loans ka wahi grouped status view jo franchise apne dashboard par dekhta hai.
*/
const getFranchiseCustomer = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw notFound("Franchise customer not found");

  const customer = await FranchiseCustomer.findById(id);
  if (!customer) throw notFound("Franchise customer not found");

  const [franchise, loans] = await Promise.all([
    Franchise.findById(customer.franchise).select("name franchiseId franchiseStatus"),
    // Sirf wahi customer + wahi owner franchise scope (service internally
    // `{ _id, franchise }` par match karti hai).
    listCustomerLoans({ _id: customer.franchise }, id),
  ]);

  return {
    customer: serializeCustomer(customer),
    franchise: franchise
      ? {
          _id: franchise._id,
          name: franchise.name,
          franchiseId: franchise.franchiseId,
          franchiseStatus: franchise.franchiseStatus,
        }
      : null,
    loans: { total: loans.total, byStatus: loans.byStatus, data: loans.data },
  };
};

/* ------------------------------------------------------------- delete -- */

/*
Super admin hi customer delete kar sakta hai (route middleware guard).

Customer ka CIBIL audit trail usi document par rehta hai, is liye document
delete hone se wo bhi hat jaata hai. Customer ka adhoora loan draft (product
apply ke beech bana temporary record) bhi saath jaata hai. Uske filed loans
financial records hain — unhe chhua nahi jaata.
*/
const deleteFranchiseCustomer = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw notFound("Franchise customer not found");

  const customer = await FranchiseCustomer.findById(id);
  if (!customer) throw notFound("Franchise customer not found");

  await FranchiseCustomerLoanDraft.deleteMany({ franchiseCustomer: customer._id });
  await customer.deleteOne();

  return {
    _id: customer._id,
    fullName: customer.fullName || "",
    mobile: customer.mobile || "",
  };
};

/* -------------------------------------------------------------- stats -- */

/*
Poore network ka customer count — franchise-wise rows jo upar sum ho kar overall
`total` banate hain. Admin ko ek nazar me dikhta hai kis franchise ne kitne
customers register kiye.
*/
const franchiseCustomerStats = async () => {
  const rows = await FranchiseCustomer.aggregate([
    { $group: { _id: "$franchise", total: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);

  const ids = rows.map((row) => row._id).filter(Boolean);
  const franchises = ids.length
    ? await Franchise.find({ _id: { $in: ids } }).select("name franchiseId franchiseStatus")
    : [];
  const byId = new Map(franchises.map((franchise) => [String(franchise._id), franchise]));

  const byFranchise = rows.map((row) => {
    const owner = row._id ? byId.get(String(row._id)) : null;

    return {
      franchise: owner
        ? {
            _id: owner._id,
            name: owner.name,
            franchiseId: owner.franchiseId,
            franchiseStatus: owner.franchiseStatus,
          }
        : null,
      total: row.total || 0,
    };
  });

  /*
  Franchise ne apne customers ke kitne aur kaunse loan file kiye — har product
  model par ek aggregate, taaki ek hi response me customer + loan dono dikhein.
  */
  const loanGroups = await Promise.all(
    Object.entries(MODELS).map(async ([productKey, Model]) => {
      const label =
        Object.values(RESOURCE_ROUTES).find((route) => route.productKey === productKey)?.label ||
        productKey;
      const groups = await Model.aggregate([
        { $match: { franchise: { $in: ids } } },
        { $group: { _id: "$franchise", total: { $sum: 1 } } },
      ]);
      return { label, groups };
    })
  );

  const loansByFranchise = new Map();
  loanGroups.forEach(({ label, groups }) => {
    groups.forEach((group) => {
      if (!group._id || !group.total) return;
      const id = String(group._id);
      const entry = loansByFranchise.get(id) || { total: 0, byProduct: [] };
      entry.total += group.total;
      entry.byProduct.push({ product: label, count: group.total });
      loansByFranchise.set(id, entry);
    });
  });

  loansByFranchise.forEach((entry) => entry.byProduct.sort((left, right) => right.count - left.count));

  byFranchise.forEach((row, index) => {
    const id = rows[index]?._id ? String(rows[index]._id) : "";
    row.loans = loansByFranchise.get(id) || { total: 0, byProduct: [] };
  });

  const total = byFranchise.reduce((sum, row) => sum + row.total, 0);

  return { total, byFranchise };
};

module.exports = {
  listFranchiseCustomers,
  countFranchiseCustomers,
  getFranchiseCustomer,
  deleteFranchiseCustomer,
  franchiseCustomerStats,
};
