const contactService = require("./contact.service");

/*
==========================================
Contact / enquiry controllers

Public: POST /api/contact   — website ka form yahan aata hai (no auth).
Admin : /api/admin/contacts — list, status/note update, delete.
==========================================
*/

/*
Create Enquiry (public)
POST /api/contact
{ name | fullName, mobile, email, topic | interest, message, source? }
*/
exports.create = async (req, res, next) => {
  try {
    const { enquiry, duplicate } = await contactService.createEnquiry(req.body, {
      ip: req.ip,
    });

    res.status(duplicate ? 200 : 201).json({
      success: true,
      message: duplicate
        ? "We already have this enquiry — our team will contact you shortly."
        : "Thanks! Your enquiry has been received. Our team will contact you shortly.",
      duplicate,
      enquiry: { id: enquiry.id, receivedAt: enquiry.receivedAt },
    });
  } catch (error) {
    next(error);
  }
};

/*
List Enquiries
GET /api/admin/contacts?status=&topic=&search=&page=&limit=
*/
exports.list = async (req, res, next) => {
  try {
    const result = await contactService.listEnquiries({
      status: req.query.status,
      topic: req.query.topic,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/*
Update Enquiry
PATCH /api/admin/contacts/:id  { status?, note? }
*/
exports.update = async (req, res, next) => {
  try {
    const enquiry = await contactService.updateEnquiry(
      req.params.id,
      req.body,
      req.admin
    );

    res.json({
      success: true,
      message: "Enquiry updated successfully",
      enquiry,
    });
  } catch (error) {
    next(error);
  }
};

/*
Delete Enquiry
DELETE /api/admin/contacts/:id
*/
exports.remove = async (req, res, next) => {
  try {
    await contactService.deleteEnquiry(req.params.id);

    res.json({ success: true, message: "Enquiry deleted successfully" });
  } catch (error) {
    next(error);
  }
};
