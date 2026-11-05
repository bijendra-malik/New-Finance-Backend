const User = require("../auth/user.model");
const { MODELS } = require("../loans/shared/loanModels");
const mongoose = require("mongoose");
const { USER_ROLE } = require("../../constants/roles");

/*
==========================================
Customers are the registered users of the public loan portal
(the "User" collection) — surfaced in the admin panel.
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

const conflict = (message) => {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
};

/*
Har customer query ka base filter: franchise accounts `users` collection me hi
rehte hain par customers nahi hain. Yahan define hota hai kyunki dashboard,
activity feed aur pending-decision queue — teenon ko yahi rule chahiye.
*/
const CUSTOMER_FILTER = { role: { $ne: USER_ROLE.FRANCHISE } };

const listCustomers = async ({ search, page, limit, isActive } = {}) => {
  // Franchise accounts live in the same collection but are managed on the
  // /api/admin/franchises endpoints, so they never show up as customers here.
  const filter = { ...CUSTOMER_FILTER };

  const q = String(search ?? "").trim();
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&"), "i");
    filter.$or = [{ name: regex }, { email: regex }, { mobile: regex }];
  }

  if (isActive === true || isActive === false) {
    filter.isActive = isActive;
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 0, 0), 100) || 0;
  const pageNumber = Math.max(Number(page) || 1, 1);

  // List me poora thread nahi chahiye: 100 rows x 200 entries ka payload banta
  // hai. Trail sirf detail endpoint se aata hai.
  const query = User.find(filter).select("-adminUpdates").sort({ createdAt: -1 });
  if (safeLimit > 0) {
    query.skip((pageNumber - 1) * safeLimit).limit(safeLimit);
  }

  const customers = await query;
  return customers;
};

const getCustomerById = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw notFound("Customer not found");
  const customer = await User.findById(id);
  if (!customer || customer.role === USER_ROLE.FRANCHISE) {
    throw notFound("Customer not found");
  }
  return customer;
};

/*
==========================================
Delete a customer.

Blocked with 409 while the customer still has loan applications that are not
in a terminal state ("Approved" / "Rejected"), so an admin cannot silently
orphan live applications. Applications already deleted are reported as 404.
==========================================
*/

const TERMINAL_STATUSES = new Set(["Approved", "Rejected"]);

const deleteCustomer = async (id) => {
  const customer = await getCustomerById(id);

  let total = 0;
  let open = 0;

  for (const Model of Object.values(MODELS)) {
    const counts = await Model.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(customer._id) } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          open: {
            $sum: {
              $cond: [
                { $in: [{ $ifNull: ["$status", "Submitted"] }, ["Submitted", "Pending"]] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    total += counts[0]?.total ?? 0;
    open += counts[0]?.open ?? 0;
  }

  if (open > 0) {
    throw conflict(
      `This customer has ${open} open application${open === 1 ? "" : "s"}. Approve or reject them before deleting the customer.`
    );
  }

  if (total > 0) {
    for (const Model of Object.values(MODELS)) {
      await Model.deleteMany({ user: customer._id });
    }
  }

  await customer.deleteOne();

  return { customer, removedApplications: total };
};

module.exports = {
  CUSTOMER_FILTER,
  listCustomers,
  getCustomerById,
  deleteCustomer,
  TERMINAL_STATUSES,
};
