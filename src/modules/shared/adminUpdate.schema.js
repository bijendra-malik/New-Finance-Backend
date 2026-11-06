const mongoose = require("mongoose");

/*
==========================================
Admin update trail — customers aur franchises

Loans par pehle se ek trail hai (modules/loans/shared/loanBasics.schema.js):
regular admin note/recommendation likhta hai, super admin final decision leta
hai aur wahi decision `kind: "status"` entry ban kar trail me chala jaata hai.
Customer aur franchise par bhi bilkul wahi pattern chahiye, isliye fields ek hi
jagah define hote hain aur dono models reuse karte hain:

  adminUpdates[]        -> poora thread (note / recommendation / status)
  statusRecommendation  -> sirf LATEST pending suggestion (super admin ke liye)

statusRecommendation alag field isliye: super admin ko "kis cheez ka decision
pending hai" ek query me pata chale, poora thread padhne ki zaroorat na pade —
aur decision lete hi field null ho jaati hai (see adminUpdate.service.js).
==========================================
*/

const MAX_UPDATE_TEXT = 500;

/* Thread append-only hai, isliye record par cap: purane 200 entries rehte hain. */
const MAX_UPDATES_PER_RECORD = 200;

/*
Category chips — regular admin batata hai usne kya kiya / kya dekha:

  verification -> PAN, Aadhaar, bank, address verify hua
  document     -> documents check / receive hue (franchise ke liye)
  visit        -> field visit / office inspection
  correction   -> record me kuch theek kiya
  flag         -> doubt / duplicate / fraud signal
  escalation   -> super admin ke dhyan me laana hai
  general      -> baaki koi baat
*/
const ENTITY_UPDATE_KINDS = ["note", "recommendation", "status"];

const CUSTOMER_UPDATE_TAGS = [
  "verification",
  "correction",
  "flag",
  "escalation",
  "general",
];

const FRANCHISE_UPDATE_TAGS = [
  "document",
  "visit",
  "verification",
  "flag",
  "escalation",
  "general",
];

/*
Har entity ka final decision jo regular admin SUGGEST kar sakta hai, aur jo
super admin apply karta hai. Customer ka decision = account chalu/band,
franchise ka decision = approve/reject (loan ka Pending/Approved/Rejected).
*/
const ENTITY_DECISIONS = {
  customer: ["Active", "Inactive"],
  franchise: ["Approved", "Rejected"],
};

const TAGS_BY_ENTITY = {
  customer: CUSTOMER_UPDATE_TAGS,
  franchise: FRANCHISE_UPDATE_TAGS,
};

const ENTITY_KEYS = ["customer", "franchise"];

/*
Schema sirf un values ko allow karta hai jo us entity ke liye banti hain. Pehle
dono entities ke tags ek hi flat enum me daale jaate the, jisse customer par
"visit" jaisa franchise-only tag DB level par save ho sakta tha (service
normalize karti hai, par schema apna gate nahi rakhta tha). Unknown entity key
par fail-fast, taaki typo se koi permissive schema na ban jaye.
*/
const entityConfig = (entity) => {
  const tags = TAGS_BY_ENTITY[entity];
  const decisions = ENTITY_DECISIONS[entity];

  if (!tags || !decisions) {
    throw new Error(`Unknown admin update entity: "${entity}"`);
  }

  return { tags, decisions };
};

/* Fresh objects — dono models ko apna independent sub-schema milta hai. */
const adminUpdateFields = (entity) => {
  const { tags, decisions } = entityConfig(entity);

  return {
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: [MAX_UPDATE_TEXT, `Update is too long (max ${MAX_UPDATE_TEXT} characters)`],
    },
    tag: { type: String, enum: tags, default: "general" },
    /* note = remark, recommendation = suggested decision, status = final decision */
    kind: { type: String, enum: ENTITY_UPDATE_KINDS, default: "note" },
    suggestedStatus: { type: String, enum: decisions, default: null },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    addedByName: { type: String, default: "" },
    addedByRole: { type: String, default: "" },
    addedAt: { type: Date, default: Date.now },
  };
};

/*
Ek field definition jo SUB-SCHEMA + `default: null` deta hai (plain nested
object nahi). Nested object me har field ka apna default hone se Mongoose har
save par khaali block likh deta tha — `{ note: "", recommendedByName: "" }` —
jisse sirf note likha hua record bhi "decision suggested" jaisa dikhta tha, aur
`statusRecommendation = null` agle save par defaults ke saath wapas aa jaata
tha. Caller ise waise hi use karta hai: `statusRecommendation: statusRecommendationFields("customer")`.
*/
const statusRecommendationFields = (entity) => {
  const { tags, decisions } = entityConfig(entity);

  const schema = new mongoose.Schema(
    {
      status: { type: String, enum: decisions, default: null },
      note: {
        type: String,
        default: "",
        maxlength: [MAX_UPDATE_TEXT, `Note is too long (max ${MAX_UPDATE_TEXT} characters)`],
      },
      tag: { type: String, enum: tags, default: "general" },
      recommendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
      recommendedByName: { type: String, default: "" },
      recommendedByRole: { type: String, default: "" },
      recommendedAt: { type: Date, default: null },
    },
    { _id: false }
  );

  return { type: schema, default: null };
};

module.exports = {
  MAX_UPDATE_TEXT,
  MAX_UPDATES_PER_RECORD,
  ENTITY_UPDATE_KINDS,
  ENTITY_KEYS,
  CUSTOMER_UPDATE_TAGS,
  FRANCHISE_UPDATE_TAGS,
  ENTITY_DECISIONS,
  TAGS_BY_ENTITY,
  adminUpdateFields,
  statusRecommendationFields,
};
