# Location Master — Admin User Guide

## Part A — Admin panel process

Base: `/api/admin/masters/location` (login: `POST /api/admin/auth/login` → Bearer token).

1. **Overview** — `GET /` counts deta hai (continents/countries/states/cities/pincodes).
2. **Hierarchy fill karo** — top-down: continents → countries → states → cities → pincodes.
   Har child create par parent ka id chahiye (`continentId` / `countryId` / `stateId` / `cityId`).
   Parent active hona chahiye; warna 400 ("activate it before adding …").
3. **Bulk data** — haath se kuch mat bharo: `npm run import:location` (India full).
4. **Pincode table** — `GET /pincodes/table`: ek hi searchable table (search: digits →
   pincode, text → city/state), pagination 50/500, `totalPages` envelope me.
5. **Edit/deactivate** — `PATCH /:resource/:id { name?, status? }`; name change par slug
   auto-update. `DELETE` soft hai (status → inactive); live children → 409 +
   `?force=true` cascade; `?hard=true` permanent (use with care).
6. **Duplicate** → 409 with "(currently inactive — set it to active instead)" hint.
   Pincode ab **per-country unique** hai — same pin do cities me nahi ja sakta.

## Part B — User (loan form) side

Public base `/api/masters/location` — no auth, sirf active rows, 120 req/min/IP limit.

1. Country/State/City dropdowns: `GET /countries` → `GET /states?countryId=` →
   `GET /cities?stateId=`.
2. Applicant State → City select karta hai, phir pincode type karta hai.
3. Form `POST /pincode/validate` call karta hai:
   `{ "pincode": "400001", "state": "Maharashtra", "city": "Mumbai" }` (ya `stateId`/`cityId`).
4. Response ALWAYS HTTP 200 + `valid` flag (400 sirf malformed input par):
   - `valid: true` → "Pincode verified successfully" (+ place chain `data` me).
   - `valid: false` + ready-to-display `message`, e.g.
     `Pincode "403001" belongs to Goa — not Karnataka. Please provide a correct pincode.`
   - `coming_soon`/`inactive` pincode → `valid: false`, "is coming soon/inactive in our
     records. Please provide a correct pincode."
5. Optional: `GET /pincode?q=4000` typeahead; `GET /pincode/:pincode` full chain lookup.

Validation **auto-fill nahi hai** — user ka chuna hua place hi decide karta hai ki pincode
acceptable hai ya nahi; galat pairing par clear correction message milta hai.
