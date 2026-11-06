const {
  ContactEnquiry,
  CONTACT_TOPICS,
  CONTACT_STATUSES,
} = require("./contact.model");
const { isValidEmail } = require("../../utils/validators");

/*
==========================================
Contact / enquiry service

Public endpoint (website ka contact form) + admin panel (list, status, delete)
dono isi service se guzarte hain, taaki validation aur response shape ek jagah
rahe.
==========================================
*/

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const notFound = (message = "Enquiry not found") => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

const text = (value) => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const MAX_MESSAGE_LENGTH = 2000;
const MAX_NOTE_LENGTH = 1000;
const MAX_PAGE_SIZE = 100;
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/* Website dropdown ka label hi bhejti hai; case/space ka farq ignore hota hai. */
const normalizeTopic = (value) => {
  const raw = text(value).toLowerCase();
  if (!raw) return "Other";
  return CONTACT_TOPICS.find((topic) => topic.toLowerCase() === raw) ?? "Other";
};

const normalizeStatus = (value) => {
  const raw = text(value).toLowerCase();
  return CONTACT_STATUSES.includes(raw) ? raw : null;
};

/*
Website aur admin panel ke field naamo me chhota farq hai (fullName vs name,
interest vs topic). Dono naam accept karte hain taaki frontend ko rename karne
ki zaroorat na pade.
*/
const validateEnquiry = (body = {}) => {
  const name = text(body.name ?? body.fullName);
  const mobile = text(body.mobile ?? body.mobileNumber ?? body.phone);
  const email = text(body.email ?? body.emailAddress).toLowerCase();
  const message = text(body.message ?? body.enquiry ?? body.remarks);
  const topic = normalizeTopic(body.topic ?? body.interest ?? body.product ?? body.subject);

  const errors = [];
  if (name.length < 2) errors.push("Full name is required");
  else if (name.length > 120) errors.push("Full name is too long (max 120 characters)");

  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    errors.push("A valid mobile number is required");
  }

  if (!isValidEmail(email)) errors.push("A valid email address is required");

  if (message.length < 5) errors.push("Message is required");
  else if (message.length > MAX_MESSAGE_LENGTH) {
    errors.push(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`);
  }

  if (errors.length) throw badRequest(errors.join(", "));

  return {
    name,
    mobile,
    email,
    topic,
    message,
    source: text(body.source) || "website-contact",
  };
};

/* Ek hi shape jo admin list aur detail dono me jaata hai. */
const toEnquiryView = (doc) => {
  const enquiry = typeof doc?.toObject === "function" ? doc.toObject() : { ...doc };

  return {
    id: String(enquiry._id ?? enquiry.id ?? ""),
    name: enquiry.name ?? "",
    mobile: enquiry.mobile ?? "",
    email: enquiry.email ?? "",
    topic: enquiry.topic ?? "Other",
    message: enquiry.message ?? "",
    source: enquiry.source ?? "website-contact",
    status: enquiry.status ?? "new",
    note: enquiry.note ?? "",
    handledByName: enquiry.handledByName ?? "",
    handledAt: enquiry.handledAt ?? null,
    receivedAt: enquiry.createdAt ?? null,
    updatedAt: enquiry.updatedAt ?? null,
  };
};

/*
Public submit. Do baar click / network retry par ek hi enquiry do baar save na
ho — same email + mobile + message 2 minute ke andar aaye to wahi record
wapas milta hai.
*/
const createEnquiry = async (body, meta = {}) => {
  const payload = validateEnquiry(body);

  const recent = await ContactEnquiry.findOne({
    email: payload.email,
    mobile: payload.mobile,
    message: payload.message,
    createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
  }).lean();

  if (recent) return { enquiry: toEnquiryView(recent), duplicate: true };

  const created = await ContactEnquiry.create({
    ...payload,
    ...(meta.ip ? { ip: String(meta.ip).slice(0, 45) } : {}),
  });

  return { enquiry: toEnquiryView(created), duplicate: false };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const listEnquiries = async ({ status, topic, search, page, limit } = {}) => {
  const filter = {};

  const wantedStatus = normalizeStatus(status);
  if (wantedStatus) filter.status = wantedStatus;

  const wantedTopic = text(topic);
  if (wantedTopic && wantedTopic.toLowerCase() !== "all") {
    filter.topic = normalizeTopic(wantedTopic);
  }

  const term = text(search);
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    filter.$or = [{ name: rx }, { email: rx }, { mobile: rx }, { message: rx }];
  }

  const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || 25));
  const safePage = Math.max(1, Number(page) || 1);

  const [docs, total, grouped] = await Promise.all([
    ContactEnquiry.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    ContactEnquiry.countDocuments(filter),
    ContactEnquiry.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const stats = { total: 0, new: 0, inProgress: 0, closed: 0 };
  grouped.forEach((row) => {
    stats.total += row.count;
    if (row._id === "new") stats.new = row.count;
    if (row._id === "in-progress") stats.inProgress = row.count;
    if (row._id === "closed") stats.closed = row.count;
  });

  return {
    enquiries: docs.map(toEnquiryView),
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
    stats,
  };
};

/* Admin: status badalna ya internal note likhna (customer ko nahi dikhta). */
const updateEnquiry = async (id, body = {}, admin = null) => {
  const enquiry = await ContactEnquiry.findById(id);
  if (!enquiry) throw notFound();

  let changed = false;

  if (body.status !== undefined) {
    const status = normalizeStatus(body.status);
    if (!status) {
      throw badRequest(`Status must be one of: ${CONTACT_STATUSES.join(", ")}`);
    }
    enquiry.status = status;
    changed = true;
  }

  if (body.note !== undefined) {
    const note = text(body.note);
    if (note.length > MAX_NOTE_LENGTH) {
      throw badRequest(`Note is too long (max ${MAX_NOTE_LENGTH} characters)`);
    }
    enquiry.note = note;
    changed = true;
  }

  if (!changed) throw badRequest("Nothing to update — send status or note");

  enquiry.handledBy = admin?.id ?? null;
  enquiry.handledByName = admin?.name || admin?.loginId || admin?.email || "Admin";
  enquiry.handledAt = new Date();

  await enquiry.save();
  return toEnquiryView(enquiry);
};

const deleteEnquiry = async (id) => {
  const removed = await ContactEnquiry.findByIdAndDelete(id);
  if (!removed) throw notFound();
  return toEnquiryView(removed);
};

module.exports = {
  CONTACT_TOPICS,
  CONTACT_STATUSES,
  toEnquiryView,
  createEnquiry,
  listEnquiries,
  updateEnquiry,
  deleteEnquiry,
};
