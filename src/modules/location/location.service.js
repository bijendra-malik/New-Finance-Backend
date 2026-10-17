const mongoose = require("mongoose");

const Continent = require("./models/continent.model");
const Country = require("./models/country.model");
const State = require("./models/state.model");
const City = require("./models/city.model");
const Pincode = require("./models/pincode.model");

const {
  LOCATION_STATUS,
  LOCATION_STATUS_VALUES,
  LOCATION_STATUS_LABELS,
  MAX_NAME_LENGTH,
  MAX_PREFIX_LENGTH,
  PINCODE_REGEX,
} = require("./location.constants");

const isTrue = require("../../utils/isTrue");

/*
==========================================
Location Master service — Continent -> Country -> State -> City -> Pincode.

Every level is its own collection, and every child document stores an
ObjectId reference to its parent. This file is the SINGLE writer, so all of
these rules are enforced in one place:

  - a child can only be created under a parent that EXISTS and is ACTIVE
  - a child can only be re-activated while its parent is active
  - duplicate names/pincodes inside the same parent are rejected (409)
  - deleting a record is a SOFT delete (status -> "inactive") by default;
    a parent with live children is refused (409) unless the caller opts
    into the cascade with ?force=true
  - ?hard=true permanently removes a record (and, with force, its subtree)

List endpoints are always scoped to the parent id the admin supplied, so a
dropdown for one state can never leak another state's cities.
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

/* ---------- Resource registry (drives every generic operation) ---------- */

const RESOURCES = {
  continents: {
    key: "continents",
    label: "Continent",
    plural: "Continents",
    model: Continent,
    parent: null,
    child: "countries",
    searchField: "name",
    sort: { name: 1 },
  },
  countries: {
    key: "countries",
    label: "Country",
    plural: "Countries",
    model: Country,
    parent: { field: "continentId", resource: "continents" },
    child: "states",
    searchField: "name",
    sort: { name: 1 },
  },
  states: {
    key: "states",
    label: "State",
    plural: "States",
    model: State,
    parent: { field: "countryId", resource: "countries" },
    child: "cities",
    searchField: "name",
    sort: { name: 1 },
  },
  cities: {
    key: "cities",
    label: "City",
    plural: "Cities",
    model: City,
    parent: { field: "stateId", resource: "states" },
    child: "pincodes",
    searchField: "name",
    sort: { name: 1 },
  },
  pincodes: {
    key: "pincodes",
    label: "Pincode",
    plural: "Pincodes",
    model: Pincode,
    parent: { field: "cityId", resource: "cities" },
    child: null,
    /* A pincode also carries its state + country, so ?stateId= / ?countryId=
       are valid filters, and both are activity-checked on reactivate. */
    extraParents: [
      { field: "stateId", resource: "states" },
      { field: "countryId", resource: "countries" },
    ],
    searchField: "pincode",
    sort: { pincode: 1 },
  },
};


const getResource = (key) => {
  const def = RESOURCES[key];
  if (!def) throw badRequest(`Unknown location resource "${key}"`);
  return def;
};

const parentLabelFor = (def) =>
  def.parent ? RESOURCES[def.parent.resource].label : null;

/* ---------- Normalizers ---------- */

const slugify = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/* Non-latin names slugify to "" — fall back to the raw lowercased name so
   the uniqueness index still has something to compare. */
const slugFor = (name) => slugify(name) || String(name).trim().toLowerCase();

const normalizeName = (value, label) => {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw badRequest(`${label} is required`);
  if (name.length > MAX_NAME_LENGTH) {
    throw badRequest(`${label} is too long (max ${MAX_NAME_LENGTH} characters)`);
  }
  return name;
};

const normalizeStatus = (value, { fallback = LOCATION_STATUS.ACTIVE } = {}) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const status = String(value).trim().toLowerCase();
  if (!LOCATION_STATUS_VALUES.includes(status)) {
    throw badRequest(`Status must be one of: ${LOCATION_STATUS_VALUES.join(", ")}`);
  }
  return status;
};

const normalizePincode = (value) => {
  const pincode = String(value ?? "").trim();
  if (!pincode) throw badRequest("Pincode is required");
  if (!PINCODE_REGEX.test(pincode)) throw badRequest("Pincode must be 3 to 10 digits");
  return pincode;
};

const normalizePrefix = (value) => {
  const prefix = String(value ?? "").trim();
  if (prefix.length > MAX_PREFIX_LENGTH) {
    throw badRequest(`Prefix is too long (max ${MAX_PREFIX_LENGTH} characters)`);
  }
  return prefix;
};

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

const parseId = (value, label) => {
  const id = String(value ?? "").trim();
  if (!id) throw badRequest(`${label} id is required`);
  /* ObjectId.isValid() alone also accepts 12-char strings — be strict. */
  if (!OBJECT_ID_REGEX.test(id)) throw badRequest(`Invalid ${label} id`);
  return id;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const describeStatus = (status) => LOCATION_STATUS_LABELS[status] || status;

/* ---------- Parent resolution ---------- */

/*
A child may only be created under a parent that exists AND is active.
Errors use the parent's own label so the message reads naturally:
"State not found", "State is inactive — activate it first".
*/
const resolveActiveParent = async (def, rawParentId) => {
  if (!def.parent) return null;

  const parentDef = RESOURCES[def.parent.resource];
  const parentId = parseId(rawParentId, parentDef.label);

  const parent = await parentDef.model.findById(parentId);
  if (!parent) throw notFound(`${parentDef.label} not found`);

  if (parent.status !== LOCATION_STATUS.ACTIVE) {
    throw badRequest(
      `${parentDef.label} "${parent.name}" is ${describeStatus(parent.status)} — ` +
        `activate it before adding ${def.plural.toLowerCase()}.`
    );
  }

  return parent;
};

/*
Same guard for edits: a record may only be moved back to active while its
parent is active. A pincode is checked against both its city and its state.
*/
const assertCanBeActive = async (def, doc) => {
  const check = async (resourceKey, id) => {
    const parentDef = RESOURCES[resourceKey];
    const parent = await parentDef.model.findById(id);
    if (!parent) throw notFound(`${parentDef.label} not found`);
    if (parent.status !== LOCATION_STATUS.ACTIVE) {
      throw badRequest(
        `${parentDef.label} "${parent.name}" is ${describeStatus(parent.status)} — ` +
          `activate it first.`
      );
    }
  };

  if (def.parent) await check(def.parent.resource, doc[def.parent.field]);

  for (const extra of def.extraParents || []) {
    if (doc[extra.field]) await check(extra.resource, doc[extra.field]);
  }
};

/* ---------- Duplicate detection ---------- */

const buildIdentity = (def, doc) => {
  /* A pincode value is unique PER COUNTRY, not per city. */
  if (def.key === "pincodes") return { pincode: doc.pincode, countryId: doc.countryId };
  return def.parent ? { slug: doc.slug, [def.parent.field]: doc[def.parent.field] } : { slug: doc.slug };
};

const describeRecord = (def, doc) =>
  def.key === "pincodes" ? `Pincode "${doc.pincode}"` : `${def.label} "${doc.name}"`;

const findDuplicate = async (def, doc, excludeId) => {
  const query = buildIdentity(def, doc);
  if (excludeId) query._id = { $ne: excludeId };
  return def.model.findOne(query);
};

const assertNoDuplicate = async (def, doc, excludeId) => {
  const existing = await findDuplicate(def, doc, excludeId);
  if (!existing) return;

  /* Pincode uniqueness is country-wide, not city-wide — say so. */
  const where =
    def.key === "pincodes"
      ? " in this country"
      : def.parent
        ? ` in this ${parentLabelFor(def).toLowerCase()}`
        : "";
  const hint =
    existing.status === LOCATION_STATUS.INACTIVE
      ? ` (currently inactive — set it to active instead)`
      : "";

  throw conflict(`${describeRecord(def, doc)} already exists${where}${hint}`);
};

/* ---------- Tree walking (cascade) ---------- */

const directChildren = async (def, ids) => {
  if (!def.child || !ids.length) return [];
  const childDef = RESOURCES[def.child];
  return childDef.model
    .find({ [childDef.parent.field]: { $in: ids } })
    .select("_id status")
    .lean();
};

/* Map of { resourceKey: [ids...] } covering the record and its whole subtree. */
const collectTreeIds = async (def, ids, acc = {}) => {
  if (!ids.length) return acc;
  acc[def.key] = [...(acc[def.key] || []), ...ids];

  const children = await directChildren(def, ids);
  if (children.length) {
    await collectTreeIds(RESOURCES[def.child], children.map((child) => child._id), acc);
  }

  return acc;
};

/* ---------- Read ---------- */

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

const parsePagination = (query, { allowAll = true } = {}) => {
  const rawLimit = query.limit;
  if (rawLimit !== undefined && String(rawLimit).toLowerCase() === "all") {
    if (!allowAll) {
      throw badRequest("limit=all is not allowed for pincodes — use ?limit= (max 5000)");
    }
    return { limit: 0, page: 1, skip: 0 };
  }

  let limit = Number(rawLimit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(Math.floor(limit), MAX_LIMIT);

  let page = Number(query.page ?? 1);
  if (!Number.isFinite(page) || page <= 0) page = 1;
  page = Math.floor(page);

  return { limit, page, skip: (page - 1) * limit };
};

const list = async (key, query = {}) => {
  const def = getResource(key);
  const filter = {};

  if (def.parent) {
    const rawParent = query[def.parent.field];
    if (rawParent !== undefined && rawParent !== null && String(rawParent).trim() !== "") {
      const parentDef = RESOURCES[def.parent.resource];
      const parentId = parseId(rawParent, parentDef.label);

      /* A stale/unknown parent id is a client bug worth surfacing. */
      const parentExists = await parentDef.model.exists({ _id: parentId });
      if (!parentExists) throw notFound(`${parentDef.label} not found`);

      filter[def.parent.field] = parentId;
    }
  }

  for (const extra of def.extraParents || []) {
    const raw = query[extra.field];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;

    const extraDef = RESOURCES[extra.resource];
    const extraId = parseId(raw, extraDef.label);
    const extraExists = await extraDef.model.exists({ _id: extraId });
    if (!extraExists) throw notFound(`${extraDef.label} not found`);

    filter[extra.field] = extraId;
  }

  if (query.status !== undefined && String(query.status).trim() !== "") {
    filter.status = normalizeStatus(query.status);
  }

  const search = String(query.search ?? query.q ?? "").trim();
  if (search) {
    filter[def.searchField] = new RegExp(escapeRegex(search), "i");
  }

  /*
  limit=all pincodes par sirf UNSCOPED calls ke liye blocked hai (19k-row
  dump guard). Parent-scoped call (?cityId= / ?stateId= / ?countryId=) ke
  pincodes chhote hote hain — admin panel ke cascade dropdowns unhe
  limit=all se hi maangte hain, isliye wo allowed hai.
  */
  const pincodesScoped =
    def.key === "pincodes" &&
    Boolean(filter.cityId || filter.stateId || filter.countryId);

  const { limit, page, skip } = parsePagination(query, {
    allowAll: def.key !== "pincodes" || pincodesScoped,
  });

  const finder = def.model.find(filter).select("-__v").sort(def.sort).skip(skip);
  if (limit > 0) finder.limit(limit);

  const [data, total] = await Promise.all([finder.lean(), def.model.countDocuments(filter)]);

  return {
    data,
    total,
    count: data.length,
    page,
    limit: limit || total,
    totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1,
  };
};

const getById = async (key, id) => {
  const def = getResource(key);
  const doc = await def.model.findById(parseId(id, def.label));
  if (!doc) throw notFound(`${def.label} not found`);
  return doc;
};

/*
Only counts — never the records themselves. This is the landing payload for
the Location Master page, so it stays O(1) in response size no matter how
many pincodes exist.
*/
const summary = async () => {
  const [totalContinents, totalCountries, totalStates, totalCities, totalPincodes] =
    await Promise.all([
      Continent.countDocuments(),
      Country.countDocuments(),
      State.countDocuments(),
      City.countDocuments(),
      Pincode.countDocuments(),
    ]);

  return { totalContinents, totalCountries, totalStates, totalCities, totalPincodes };
};

/*
==========================================
Flat pincode table (admin panel view)

One row per pincode, across EVERY city, with the city/state/country names
already attached — so the panel can render a single searchable table without
chaining five cascading requests.

Server-side pagination is small by default (50) because India has ~19k
pincodes; widening the query is explicit via ?limit=.

Name resolution is done in bulk (3 extra indexed reads for the whole page),
never per row, so a 500-row page costs the same number of queries as a 50-row
page. Search is indexed too: digits match the pincode, text matches city or
state names and is resolved to ids before the pincode query runs.
==========================================
*/

const FLAT_DEFAULT_LIMIT = 50;
const FLAT_MAX_LIMIT = 500;

const listPincodesFlat = async (query = {}) => {
  const filter = {};

  if (query.cityId !== undefined && String(query.cityId).trim() !== "") {
    filter.cityId = parseId(query.cityId, "City");
  }
  if (query.stateId !== undefined && String(query.stateId).trim() !== "") {
    filter.stateId = parseId(query.stateId, "State");
  }
  if (query.countryId !== undefined && String(query.countryId).trim() !== "") {
    filter.countryId = parseId(query.countryId, "Country");
  }
  if (query.status !== undefined && String(query.status).trim() !== "") {
    filter.status = normalizeStatus(query.status);
  }

  const search = String(query.search ?? query.q ?? "").trim();
  if (search) {
    if (/^\d+$/.test(search)) {
      filter.pincode = new RegExp(`^${escapeRegex(search)}`);
    } else {
      /* Slug-PREFIX match (indexed) instead of an unindexed /name/i scan. */
      const slugRx = new RegExp(`^${escapeRegex(slugFor(search))}`);
      const [matchedCities, matchedStates] = await Promise.all([
        City.find({ slug: slugRx }).select("_id").lean(),
        State.find({ slug: slugRx }).select("_id").lean(),
      ]);

      filter.$or = [
        { cityId: { $in: matchedCities.map((city) => city._id) } },
        { stateId: { $in: matchedStates.map((state) => state._id) } },
      ];
    }
  }

  let limit = Number(query.limit ?? FLAT_DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) limit = FLAT_DEFAULT_LIMIT;
  limit = Math.min(Math.floor(limit), FLAT_MAX_LIMIT);

  let page = Number(query.page ?? 1);
  if (!Number.isFinite(page) || page <= 0) page = 1;
  page = Math.floor(page);

  const [rows, total] = await Promise.all([
    Pincode.find(filter)
      .select("-__v")
      .sort({ pincode: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Pincode.countDocuments(filter),
  ]);

  const cityIds = [...new Set(rows.map((row) => String(row.cityId)))];
  const stateIds = [...new Set(rows.map((row) => String(row.stateId)))];

  const [cities, states] = await Promise.all([
    City.find({ _id: { $in: cityIds } }).select("name").lean(),
    State.find({ _id: { $in: stateIds } }).select("name countryId").lean(),
  ]);

  const countries = await Country.find({
    _id: { $in: [...new Set(states.map((state) => String(state.countryId)))] },
  })
    .select("name")
    .lean();

  const cityName = new Map(cities.map((city) => [String(city._id), city.name]));
  const stateById = new Map(states.map((state) => [String(state._id), state]));
  const countryName = new Map(countries.map((country) => [String(country._id), country.name]));

  const data = rows.map((row) => {
    const state = stateById.get(String(row.stateId));

    return {
      ...row,
      city: cityName.get(String(row.cityId)) || null,
      state: state ? state.name : null,
      country: state ? countryName.get(String(state.countryId)) || null : null,
    };
  });

  return {
    data,
    count: data.length,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
};

/* ---------- Pincode lookup (user enters a pincode, we resolve the place) ---------- */

const assertPincodeFormat = (rawPincode) => {
  const pincode = String(rawPincode ?? "").trim();
  if (!pincode) throw badRequest("Pincode is required");
  if (!PINCODE_REGEX.test(pincode)) throw badRequest("Pincode must be 3 to 10 digits");
  return pincode;
};

/* Case/punctuation-insensitive name comparison: "Jammu & Kashmir" === "Jammu and Kashmir". */
const normalizePlaceName = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const samePlaceName = (left, right) =>
  Boolean(left) && Boolean(right) && normalizePlaceName(left) === normalizePlaceName(right);

const toPlaceShape = ({ pin, city, state, country, continent }) => ({
  pincode: pin.pincode,
  prefix: pin.prefix || pin.pincode.slice(0, 3),
  status: pin.status,
  cityId: city._id,
  city: city.name,
  stateId: state._id,
  state: state.name,
  countryId: country._id,
  country: country.name,
  continentId: continent ? continent._id : country.continentId,
  continent: continent ? continent.name : null,
});

/*
Walks the pincode up its own reference chain (pincode -> city -> state ->
country -> continent). Returns:

  { found: false }                            pincode not in the master at all
  { found: true, serviceable: false, pinStatus }  pin exists but is inactive
                                              (admin disabled it) or
                                              coming_soon (not live yet) —
                                              or a city/state/country above it
                                              is missing or deactivated
  { found: true, serviceable: true, ... }      fully resolvable

Only an ACTIVE pin resolves, so switching a city/pincode to inactive (or
coming_soon) in the admin panel immediately stops it resolving in the public
forms. `pinStatus` tells callers WHICH non-active state the row is in.
*/
/*
Latency note: every Mongo round-trip costs ~60-80ms on the hosted DB, so this
chain is deliberately BATCHED — the pin comes first, then city/state/country
fly in ONE parallel batch (pin carries countryId), and the continent only
when the caller actually needs it (lookup yes, validate no).
*/
const findPincodeChain = async (rawPincode, { withContinent = true } = {}) => {
  const pincode = assertPincodeFormat(rawPincode);

  /* The pin row itself must be ACTIVE to resolve: inactive = the admin
     disabled it, coming_soon = not serviceable YET. pinStatus lets callers
     tell the two apart; both are treated as not serviceable. */
  const pin = await Pincode.findOne({ pincode }).lean();

  if (!pin || pin.status !== LOCATION_STATUS.ACTIVE) {
    return {
      found: Boolean(pin),
      serviceable: false,
      pincode,
      pin,
      pinStatus: pin ? pin.status : null,
    };
  }

  const [city, state, countryOrNull] = await Promise.all([
    City.findOne({ _id: pin.cityId, status: LOCATION_STATUS.ACTIVE }).lean(),
    State.findOne({ _id: pin.stateId, status: LOCATION_STATUS.ACTIVE }).lean(),
    pin.countryId
      ? Country.findOne({ _id: pin.countryId, status: LOCATION_STATUS.ACTIVE }).lean()
      : Promise.resolve(null),
  ]);

  if (!city || !state) return { found: true, serviceable: false, pincode, pin };

  /* Legacy rows without countryId fall back to the state's pointer. */
  let country = countryOrNull;
  if (!country) {
    country = await Country.findOne({
      _id: state.countryId,
      status: LOCATION_STATUS.ACTIVE,
    }).lean();
  }
  if (!country) return { found: true, serviceable: false, pincode, pin };

  if (!withContinent) {
    return { found: true, serviceable: true, pincode, pin, city, state, country, continent: null };
  }

  const continent = await Continent.findOne({
    _id: country.continentId,
    status: LOCATION_STATUS.ACTIVE,
  }).lean();

  return { found: true, serviceable: true, pincode, pin, city, state, country, continent };
};

/*
==========================================
In-memory pincode chain cache (public read path)

Hosted/remote DB par har round-trip ~60-80ms leta hai, aur pincode lookup/
validate read-heavy + read-only hain — isliye resolved chain process-local
Map me cache hoti hai (repeat lookup ~0 DB calls).

Invalidation: service ka create/update/remove (SINGLE writer) cache turant
clear karta hai — admin deactivate kare to public forms MEHNAT ke bina
instant band. Importer/direct DB writes ke liye 5-minute TTL safety net hai.
Sizing guard: 25k chains ke baad self-clear (~30MB ceiling).
==========================================
*/

const PIN_CHAIN_CACHE_TTL_MS = 5 * 60 * 1000;
const PIN_CHAIN_CACHE_MAX = 25000;

let pinChainCache = new Map();
let pinChainCacheAt = Date.now();

const invalidatePincodeCache = () => {
  pinChainCache = new Map();
  pinChainCacheAt = Date.now();
};

const cachedPincodeChain = async (rawPincode) => {
  if (Date.now() - pinChainCacheAt > PIN_CHAIN_CACHE_TTL_MS) invalidatePincodeCache();

  const pincode = assertPincodeFormat(rawPincode);
  if (pinChainCache.has(pincode)) return pinChainCache.get(pincode);

  /* Full chain (continent included) so ONE cache entry serves both the
     lookup and the validate response shape. */
  const chain = await findPincodeChain(pincode, { withContinent: true });

  /* Sirf positive chains cache hoti hain — naya pincode import ho to
     purana "not found" stale nahi ho sakta. */
  if (chain.found && chain.serviceable) {
    if (pinChainCache.size >= PIN_CHAIN_CACHE_MAX) invalidatePincodeCache();
    pinChainCache.set(pincode, chain);
  }

  return chain;
};

/*
GET /api/masters/location/pincode/:pincode

Resolves a user-typed pincode to its full place chain:

  "400001" -> { pincode, city: "Mumbai", state: "Maharashtra",
                country: "India", continent: "Asia", ...ids }

The names are returned alongside the ids so a form can pre-select its existing
state/city dropdowns.
*/
const lookupPincode = async (rawPincode) => {
  const chain = await cachedPincodeChain(rawPincode); /* full chain incl. continent */

  if (!chain.found) throw notFound(`Pincode "${chain.pincode}" not found`);
  if (!chain.serviceable) {
    throw notFound(
      chain.pinStatus
        ? `Pincode "${chain.pincode}" is ${describeStatus(chain.pinStatus)} — not serviceable yet`
        : `Pincode "${chain.pincode}" is not serviceable`
    );
  }

  return toPlaceShape(chain);
};

/*
==========================================
Pincode VALIDATION against a chosen place (applicant form)

The form already has State -> City selected and the applicant types the
pincode. Instead of the pincode deciding the place, the place decides whether
the pincode is acceptable:

  "400001" + Mumbai, Maharashtra -> valid
  "400001" + Pune,   Maharashtra -> invalid (that pincode is Mumbai's)
  "400001" + Bengaluru, Karnataka -> invalid (wrong state)
  "999999" + anything             -> invalid (not in the master at all)

The state/city may be sent as names (what the current dropdowns hold) or as
relational ids. Answers are returned, not thrown, so a well-formed request is
always HTTP 200 with a `valid` flag and a ready-to-display `message`.

strict:
  false (default) - if the selected city cannot be found in our records we
                    skip the city comparison rather than reject a genuine
                    applicant (the current state/city dropdowns come from the
                    legacy masters, so some names may not exist here yet).
  true            - an unverifiable city is treated as invalid.
==========================================
*/
const validatePincodeForPlace = async (input = {}) => {
  const pincode = assertPincodeFormat(input.pincode ?? input.pin ?? input.value);

  const stateRef = input.state ?? input.stateName;
  const cityRef = input.city ?? input.cityName;
  const rawStateId = input.stateId;
  const rawCityId = input.cityId;
  const strict = isTrue(input.strict);

  if (!stateRef && !cityRef && !rawStateId && !rawCityId) {
    throw badRequest("Pass the selected state or city so the pincode can be checked against it");
  }

  /* Cached full chain — applicant ke liye continent ka koi kaam nahi, par
     ek hi cache entry lookup+validate dono serve karti hai. */
  const chain = await cachedPincodeChain(pincode);

  if (!chain.found) {
    return {
      valid: false,
      stateChecked: false,
      cityChecked: false,
      message: `Pincode "${pincode}" is wrong. Please provide a correct pincode.`,
      data: null,
    };
  }

  if (!chain.serviceable) {
    return {
      valid: false,
      stateChecked: false,
      cityChecked: false,
      message: `Pincode "${pincode}" is ${
        chain.pinStatus ? describeStatus(chain.pinStatus) : "not available"
      } in our records. Please provide a correct pincode.`,
      data: null,
    };
  }

  /*
  Round-trip economy: after the pin, EVERY lookup below is independent — so
  state + city fly in ONE parallel batch (2 round-trips total) instead of
  4-5 sequential hops.
  */
  const stateByIdOrSlug = rawStateId
    ? { _id: parseId(rawStateId, "State") }
    : stateRef
      ? { slug: slugFor(stateRef) }
      : null;
  const cityByIdOrSlug = rawCityId
    ? { _id: parseId(rawCityId, "City") }
    : cityRef
      ? { slug: slugFor(cityRef) }
      : null;

  const [selectedState, selectedCityFirst] = await Promise.all([
    stateByIdOrSlug ? State.findOne(stateByIdOrSlug).lean() : Promise.resolve(null),
    cityByIdOrSlug ? City.findOne(cityByIdOrSlug).lean() : Promise.resolve(null),
  ]);

  /* Same city name in several states and no state given — accept it only
     when the name is unambiguous (rare follow-up probe). */
  let selectedCity = selectedCityFirst;
  if (!selectedCity && (cityRef || rawCityId) && !selectedState) {
    const candidates = await City.find({ slug: slugFor(cityRef) }).limit(2).lean();
    if (candidates.length === 1) selectedCity = candidates[0];
  }

  const place = toPlaceShape(chain);

  const stateChecked = Boolean(selectedState);
  const cityChecked = Boolean(selectedCity);

  if (stateChecked && !samePlaceName(selectedState.name, chain.state.name)) {
    return {
      valid: false,
      stateChecked,
      cityChecked,
      message: `Pincode "${pincode}" belongs to ${chain.state.name} — not ${selectedState.name}. Please provide a correct pincode.`,
      data: place,
    };
  }

  if (cityChecked && String(selectedCity._id) !== String(chain.city._id)) {
    return {
      valid: false,
      stateChecked,
      cityChecked,
      message: `Pincode "${pincode}" belongs to ${chain.city.name}, ${chain.state.name} — not ${selectedCity.name}. Please provide a correct pincode.`,
      data: place,
    };
  }

  if (strict && (cityRef || rawCityId) && !cityChecked) {
    return {
      valid: false,
      stateChecked,
      cityChecked,
      message: `We could not match "${cityRef ?? rawCityId}" in our location data. Please provide a correct pincode.`,
      data: place,
    };
  }

  return {
    valid: true,
    stateChecked,
    cityChecked,
    message: "Pincode verified successfully",
    data: place,
  };
};

/*
Type-ahead for the pincode box. Digits search the pincode itself
("4000" -> 400001, 400002, ...), anything else searches city names.
*/
const suggestPincodes = async (rawQuery, rawLimit = 10) => {
  const query = String(rawQuery ?? "").trim();
  if (query.length < 2) throw badRequest("Type at least 2 characters to search");

  let limit = Number(rawLimit);
  if (!Number.isFinite(limit) || limit <= 0) limit = 10;
  limit = Math.min(Math.floor(limit), 25);

  let pins = [];
  /* Letters path me city names pehli query ke saath hi aa jaate hain —
     tail me sirf missing (digits path) wale fetch karne padte hain. */
  const cityName = new Map();

  if (/^\d+$/.test(query)) {
    pins = await Pincode.find({
      pincode: new RegExp(`^${escapeRegex(query)}`),
      status: LOCATION_STATUS.ACTIVE,
    })
      .sort({ pincode: 1 })
      .limit(limit)
      .lean();
  } else {
    /* Indexed slug-prefix match instead of an unindexed /name/i scan. */
    const cities = await City.find({
      slug: new RegExp(`^${escapeRegex(slugFor(query))}`),
      status: LOCATION_STATUS.ACTIVE,
    })
      .sort({ name: 1 })
      .limit(limit)
      .lean();

    for (const city of cities) cityName.set(String(city._id), city.name);

    if (cities.length) {
      pins = await Pincode.find({
        cityId: { $in: cities.map((city) => city._id) },
        status: LOCATION_STATUS.ACTIVE,
      })
        .sort({ pincode: 1 })
        .limit(limit)
        .lean();
    }
  }

  if (!pins.length) return [];

  /* Remaining labels (digits path ke city names + state names) — dono
     fetch ek hi parallel round-trip me. */
  const missingCityIds = [
    ...new Set(
      pins.map((pin) => pin.cityId).filter((id) => !cityName.has(String(id)))
    ),
  ];

  const [cityRows, states] = await Promise.all([
    missingCityIds.length
      ? City.find({ _id: { $in: missingCityIds } }).select("name").lean()
      : Promise.resolve([]),
    State.find({ _id: { $in: [...new Set(pins.map((pin) => pin.stateId))] } })
      .select("name")
      .lean(),
  ]);

  for (const city of cityRows) cityName.set(String(city._id), city.name);
  const stateName = new Map(states.map((state) => [String(state._id), state.name]));

  return pins.map((pin) => ({
    pincode: pin.pincode,
    cityId: pin.cityId,
    city: cityName.get(String(pin.cityId)) || null,
    stateId: pin.stateId,
    state: stateName.get(String(pin.stateId)) || null,
  }));
};

/* ---------- Create ---------- */

const buildCreatePayload = (def, parent, body = {}) => {
  if (def.key === "pincodes") {
    return {
      stateId: parent.stateId,
      cityId: parent._id,
      pincode: normalizePincode(body.pincode ?? body.code ?? body.value),
      prefix: normalizePrefix(body.prefix),
      status: normalizeStatus(body.status),
    };
  }

  const name = normalizeName(body.name ?? body.value, `${def.label} name`);

  return {
    name,
    slug: slugFor(name),
    status: normalizeStatus(body.status),
    ...(def.parent ? { [def.parent.field]: parent._id } : {}),
  };
};

const create = async (key, body = {}) => {
  const def = getResource(key);
  const parent = await resolveActiveParent(def, body[def.parent?.field]);
  const payload = buildCreatePayload(def, parent, body);

  /*
  A pincode carries its full chain: its CITY (the parent) must be active, and
  so must its STATE and COUNTRY — all three ids are denormalized onto the row.
  */
  if (def.key === "pincodes") {
    const state = await State.findById(parent.stateId);
    if (!state) throw notFound("State not found");
    if (state.status !== LOCATION_STATUS.ACTIVE) {
      throw badRequest(
        `State "${state.name}" is ${describeStatus(state.status)} — ` +
          `activate it before adding pincodes.`
      );
    }

    const country = await Country.findById(state.countryId);
    if (!country) throw notFound("Country not found");
    if (country.status !== LOCATION_STATUS.ACTIVE) {
      throw badRequest(
        `Country "${country.name}" is ${describeStatus(country.status)} — ` +
          `activate it before adding pincodes.`
      );
    }

    payload.countryId = country._id;
    payload.stateId = state._id;
  }

  await assertNoDuplicate(def, payload);

  const doc = await def.model.create(payload);
  invalidatePincodeCache(); /* naya pin/location = purani cached chains stale */

  return doc.toObject({ versionKey: false });
};

/* ---------- Update ---------- */

const update = async (key, id, body = {}) => {
  const def = getResource(key);
  const doc = await getById(key, id);

  const updates = {};

  if (def.key === "pincodes") {
    if (body.pincode !== undefined || body.code !== undefined || body.value !== undefined) {
      updates.pincode = normalizePincode(body.pincode ?? body.code ?? body.value);
    }
    if (body.prefix !== undefined) updates.prefix = normalizePrefix(body.prefix);
  } else if (body.name !== undefined || body.value !== undefined) {
    const name = normalizeName(body.name ?? body.value, `${def.label} name`);
    if (name !== doc.name) {
      updates.name = name;
      updates.slug = slugFor(name);
    }
  }

  if (body.status !== undefined) {
    const status = normalizeStatus(body.status, { fallback: doc.status });
    if (status === LOCATION_STATUS.ACTIVE && doc.status !== LOCATION_STATUS.ACTIVE) {
      await assertCanBeActive(def, doc);
    }
    if (status !== doc.status) updates.status = status;
  }

  if (!Object.keys(updates).length) {
    throw badRequest(`Nothing to update on this ${def.label.toLowerCase()}`);
  }

  await assertNoDuplicate(def, { ...doc.toObject({ versionKey: false }), ...updates }, doc._id);

  Object.assign(doc, updates);
  await doc.save();
  invalidatePincodeCache(); /* status/name edits turant public forms me dikhen */

  return doc.toObject({ versionKey: false });
};

/* ---------- Delete (soft by default) ---------- */

const remove = async (key, id, { hard = false, force = false } = {}) => {
  const def = getResource(key);
  const doc = await getById(key, id);

  let blocked = [];
  if (def.child) {
    const children = await directChildren(def, [doc._id]);
    /* Already-inactive children do not block; anything else does. */
    blocked = hard
      ? children
      : children.filter((child) => child.status !== LOCATION_STATUS.INACTIVE);

    if (blocked.length && !force) {
      const childPlural = RESOURCES[def.child].plural.toLowerCase();
      throw conflict(
        `${describeRecord(def, doc)} has ${blocked.length} ${childPlural} — ` +
          `pass ?force=true to ${hard ? "delete" : "deactivate"} them too.`
      );
    }
  }

  const treeIds = await collectTreeIds(def, [doc._id]);
  const affected = {};

  for (const [resourceKey, ids] of Object.entries(treeIds)) {
    if (!ids.length) continue;
    const resourceDef = RESOURCES[resourceKey];

    if (hard) {
      const result = await resourceDef.model.deleteMany({ _id: { $in: ids } });
      affected[resourceKey] = result.deletedCount || 0;
    } else {
      const result = await resourceDef.model.updateMany(
        { _id: { $in: ids }, status: { $ne: LOCATION_STATUS.INACTIVE } },
        { $set: { status: LOCATION_STATUS.INACTIVE } }
      );
      affected[resourceKey] = result.modifiedCount || 0;
    }
  }

  invalidatePincodeCache(); /* deactivate/cascade/hard-delete sab public se turant gayab */

  return {
    id: doc._id,
    mode: hard ? "deleted" : "deactivated",
    affected,
  };
};

module.exports = {
  RESOURCES,
  slugFor,
  list,
  getById,
  summary,
  listPincodesFlat,
  lookupPincode,
  validatePincodeForPlace,
  suggestPincodes,
  create,
  update,
  remove,
  models: { Continent, Country, State, City, Pincode },
};
