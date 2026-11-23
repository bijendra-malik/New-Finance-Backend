const customerService = require("./customer.service");
const {
  listCustomerApplications,
} = require("../loans/shared/adminStatus.service");
const {
  addEntityUpdate,
  pushStatusUpdate,
} = require("./adminUpdate.service");
const { MAX_UPDATE_TEXT } = require("../shared/adminUpdate.schema");

/*
==========================================
List Customers
GET /api/admin/customers?search=&page=&limit=&isActive=
==========================================
*/
exports.list = async (req, res, next) => {
  try {
    const { search, page, limit, isActive } = req.query;

    let activeFilter;
    if (isActive === "true") activeFilter = true;
    else if (isActive === "false") activeFilter = false;

    const customers = await customerService.listCustomers({
      search,
      page,
      limit,
      isActive: activeFilter,
    });
    res.json({ success: true, customers });
  } catch (error) {
    next(error);
  }
};

/*
==========================================
Get One Customer
GET /api/admin/customers/:id
==========================================
*/
exports.getOne = async (req, res, next) => {
  try {
    const customer = await customerService.getCustomerById(req.params.id);
    res.json({ success: true, customer });
  } catch (error) {
    next(error);
  }
};

/*
==========================================
Delete Customer (P0)
DELETE /api/admin/customers/:id

404 unknown id, 409 while the customer still has open (Submitted/Pending)
applications; a closed-history customer is removed together with their
application archive.
==========================================
*/
exports.remove = async (req, res, next) => {
  try {
    const { customer, removedApplications } = await customerService.deleteCustomer(req.params.id);

    res.json({
      success: true,
      message:
        removedApplications > 0
          ? `Customer deleted successfully along with ${removedApplications} closed application${removedApplications === 1 ? "" : "s"}`
          : "Customer deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

/*
==========================================
Set Customer Active Status
PATCH /api/admin/customers/:id/status   { isActive: true|false, note? }

Super admin ka final decision. Reason trail me `kind: "status"` entry ban kar
jaata hai (loan ke PATCH /:id/status jaisa) aur koi pending recommendation
clear ho jaati hai.
==========================================
*/
exports.setStatus = async (req, res, next) => {
  try {
    const { isActive, note } = req.body ?? {};
    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false",
      });
    }

    const noteText = note === undefined || note === null ? "" : String(note).trim();
    if (noteText.length > MAX_UPDATE_TEXT) {
      return res.status(400).json({
        success: false,
        message: `Reason is too long (max ${MAX_UPDATE_TEXT} characters)`,
      });
    }

    const customer = await customerService.getCustomerById(req.params.id);

    if (customer.isActive === isActive) {
      return res.status(409).json({
        success: false,
        message: `Customer is already ${isActive ? "active" : "inactive"}`,
      });
    }

    const from = customer.isActive ? "Active" : "Inactive";
    pushStatusUpdate(customer, req, {
      entity: "customer",
      tag: isActive ? "verification" : "flag",
      status: isActive ? "Active" : "Inactive",
      text: `Account ${from} → ${isActive ? "Active" : "Inactive"}${noteText ? ` — ${noteText}` : ""}`,
    });
    customer.isActive = isActive;
    await customer.save();

    res.json({
      success: true,
      message: `Customer ${isActive ? "activated" : "deactivated"} successfully`,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

/*
==========================================
Add Customer Update
POST /api/admin/customers/:id/updates
Body: { text: string, tag?: string, suggestedStatus?: "Active"|"Inactive" }

Sirf REGULAR admin likh sakta hai — super admin ka kaam message likhna nahi,
final decision lena hai (isliye 403). Decision suggest karte hi wo super admin
ke "decision pending" queue me aa jaata hai.
==========================================
*/
exports.addUpdate = async (req, res, next) => {
  try {
    const { text, tag, suggestedStatus } = req.body ?? {};
    const customer = await customerService.getCustomerById(req.params.id);

    addEntityUpdate(customer, req, {
      entity: "customer",
      text,
      tag,
      suggestedStatus,
    });

    await customer.save();

    /* Loan jaisa shape: `loan` ki jagah `customer`, poora doc (trail included). */
    res.json({
      success: true,
      message: "Update added successfully",
      customer,
    });
  } catch (error) {
    next(error);
  }
};

/*
==========================================
Applications of one customer
GET /api/admin/customers/:id/applications
==========================================
*/
exports.listApplications = listCustomerApplications;

/*
==========================================
Customer overview (read-only)
GET /api/admin/customers/:id/overview

Customer + uske loans ka product-wise summary; drawer/list se alag ek poora
overview page isi par banta hai.
==========================================
*/
exports.overview = async (req, res, next) => {
  try {
    const { customer, loans } = await customerService.getCustomerOverview(
      req.params.id,
      req.admin
    );

    res.json({ success: true, customer, loans });
  } catch (error) {
    next(error);
  }
};
