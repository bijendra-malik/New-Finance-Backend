const User = require("../auth/user.model");
const Franchise = require("../franchise/franchise.model");
const { isSuperAdmin } = require("./adminLoanAccess");
const { CUSTOMER_FILTER } = require("./customer.service");
const {
  ENTITY_DECISIONS,
  ENTITY_UPDATE_KINDS,
  MAX_UPDATE_TEXT,
  MAX_UPDATES_PER_RECORD,
  TAGS_BY_ENTITY,
} = require("../shared/adminUpdate.schema");

/*
==========================================
Customer / franchise admin-update trail

Wahi rule jo loan products me hai (loans/shared/adminStatus.service.js):

  regular admin -> note / verification / flag / escalation, ya decision
                   SUGGEST kar sakta hai (customer: Active|Inactive,
                   franchise: Approved|Rejected)
  super admin   -> thread par message nahi likh sakta (403); uska kaam final
                   decision hai, jo `kind: "status"` entry ban kar trail me
                   automatically chala jaata hai

`statusRecommendation` latest pending suggestion rakhta hai taaki super admin
ko "kis record ka decision pending hai" ek query me mil jaye; decision lete hi
wo field clear ho jaati hai.
==========================================
*/

/* Super admin ki pending queue ek response me kitni lambi ho sakti hai. */
const MAX_PENDING = 50;

/* Error helpers — repo ka wahi naam/pattern (customer/franchise service). */
const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const forbidden = (message) => {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
};

const assertCanWriteUpdate = (admin) => {
  if (isSuperAdmin(admin)) {
    throw forbidden(
      "Super admins cannot add updates on customers or franchises — only regular admins can. Apply the final decision instead."
    );
  }
};

const tagsFor = (entity) => TAGS_BY_ENTITY[entity] || ["general"];

const normalizeTag = (tag, entity) => {
  const value = String(tag ?? "").trim().toLowerCase();
  return tagsFor(entity).includes(value) ? value : "general";
};

const actorOf = (admin = {}) => ({
  addedBy: admin.id || admin._id || null,
  addedByName:
    admin.name || admin.fullName || admin.loginId || admin.email || "Admin",
  addedByRole: admin.role || "",
});

/** Cap the trail so a long-lived record cannot grow without limit. */
const capThread = (doc) => {
  if (
    Array.isArray(doc.adminUpdates) &&
    doc.adminUpdates.length > MAX_UPDATES_PER_RECORD
  ) {
    doc.adminUpdates = doc.adminUpdates.slice(0, MAX_UPDATES_PER_RECORD);
  }
};

/**
 * Thread entry + (optional) pending recommendation.
 * Caller object.save() karta hai — yahan save nahi hota, taaki controller apne
 * status change ke saath ek hi write me sab kuch bheje.
 */
const addEntityUpdate = (doc, req, { entity, text, tag, suggestedStatus }) => {
  assertCanWriteUpdate(req?.admin);

  const decisions = ENTITY_DECISIONS[entity] || [];
  const updateText = String(text ?? "").trim();
  const suggestion = String(suggestedStatus ?? "").trim();

  if (suggestion && !decisions.includes(suggestion)) {
    throw badRequest(
      `Suggested decision must be one of: ${decisions.join(", ")}`
    );
  }
  if (!updateText && !suggestion) {
    throw badRequest("Update text or a suggested decision is required");
  }
  if (updateText.length > MAX_UPDATE_TEXT) {
    throw badRequest(`Update is too long (max ${MAX_UPDATE_TEXT} characters)`);
  }

  const tagValue = normalizeTag(tag, entity);
  const actor = actorOf(req?.admin);

  if (suggestion) {
    doc.statusRecommendation = {
      status: suggestion,
      note: updateText,
      tag: tagValue,
      recommendedBy: actor.addedBy,
      recommendedByName: actor.addedByName,
      recommendedByRole: actor.addedByRole,
      recommendedAt: new Date(),
    };
  }

  if (!Array.isArray(doc.adminUpdates)) doc.adminUpdates = [];
  doc.adminUpdates.unshift({
    text: updateText || `Recommended ${suggestion}`,
    tag: tagValue,
    kind: suggestion ? "recommendation" : "note",
    suggestedStatus: suggestion || null,
    ...actor,
    addedAt: new Date(),
  });
  capThread(doc);

  return doc.adminUpdates[0];
};

/**
 * Final decision log (super admin) — approve/reject ya account enable/disable.
 * Pending recommendation yahin clear hoti hai: decision ho gaya.
 */
const pushStatusUpdate = (doc, req, { entity, text, status, tag = "general" }) => {
  /*
  Yahan throw nahi karte: decision service apna kaam kar chuki hoti hai, isliye
  lambe reason ko trim karke likhte hain (500 chars par mongoose validation
  error aata, aur client ko galat 400 dikhta).
  */
  const statusText = String(text ?? "").trim().slice(0, MAX_UPDATE_TEXT);

  if (!Array.isArray(doc.adminUpdates)) doc.adminUpdates = [];
  doc.adminUpdates.unshift({
    text:
      statusText ||
      `${entity === "franchise" ? "Franchise" : "Customer"} marked ${status}`,
    tag: normalizeTag(tag, entity),
    kind: "status",
    suggestedStatus: status || null,
    ...actorOf(req?.admin),
    addedAt: new Date(),
  });
  capThread(doc);

  /* Decision is final — a pending suggestion is stale now. */
  doc.statusRecommendation = null;

  return doc.adminUpdates[0];
};

const latestUpdateOf = (doc) =>
  Array.isArray(doc.adminUpdates) && doc.adminUpdates.length
    ? doc.adminUpdates[0]
    : null;

const toPendingDecision = (entity, doc) => {
  const recommendation = doc.statusRecommendation || {};
  const latest = latestUpdateOf(doc);

  return {
    entity,
    id: String(doc._id),
    name: doc.name || doc.fullName || "",
    referenceNo: entity === "customer" ? doc.customerId || null : doc.franchiseId || null,
    status: entity === "customer" ? (doc.isActive ? "Active" : "Inactive") : doc.franchiseStatus || "Pending",
    suggestedStatus: recommendation.status || latest?.suggestedStatus || null,
    note: recommendation.note || latest?.text || "",
    tag: recommendation.tag || latest?.tag || "general",
    requestedByName: recommendation.recommendedByName || latest?.addedByName || "Admin",
    requestedAt: recommendation.recommendedAt || latest?.addedAt || null,
  };
};

/**
 * Super admin ka "decision pending" queue: jin customers/franchises par kisi
 * regular admin ne decision suggest kiya hai aur abhi tak final decision nahi
 * hua. Escalation tag wali latest entry bhi yahan aati hai.
 *
 * Filter me `$ne: null` ki jagah us entity ke allowed decisions likhe hain:
 * `$ne` index se poori range scan karta hai, `$in` seedha index lookup hai.
 */
const collectPendingDecisions = async () => {
  const [customers, franchises] = await Promise.all([
    User.find({
      ...CUSTOMER_FILTER,
      "statusRecommendation.status": { $in: ENTITY_DECISIONS.customer },
    })
      .select("name customerId isActive adminUpdates statusRecommendation")
      .sort({ "statusRecommendation.recommendedAt": -1 })
      .limit(MAX_PENDING)
      .lean(),
    Franchise.find({
      "statusRecommendation.status": { $in: ENTITY_DECISIONS.franchise },
    })
      .select("name franchiseId franchiseStatus adminUpdates statusRecommendation")
      .sort({ "statusRecommendation.recommendedAt": -1 })
      .limit(MAX_PENDING)
      .lean(),
  ]);

  const items = [
    ...customers.map((doc) => toPendingDecision("customer", doc)),
    ...franchises.map((doc) => toPendingDecision("franchise", doc)),
  ].sort(
    (left, right) =>
      new Date(right.requestedAt || 0) - new Date(left.requestedAt || 0)
  );

  return { total: items.length, items };
};

module.exports = {
  assertCanWriteUpdate,
  normalizeTag,
  addEntityUpdate,
  pushStatusUpdate,
  collectPendingDecisions,
  ENTITY_UPDATE_KINDS,
};
