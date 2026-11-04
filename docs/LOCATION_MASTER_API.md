# Location Master — API Reference

Relational location master: `Continent → Country → State → City → Pincode`.
Har child apne parent ka ObjectId rakhta hai. Status enum: `active | inactive | coming_soon`.
Delete = SOFT delete (status → inactive); `?hard=true` permanent.

- Admin base: `/api/admin/masters/location` (admin auth required)
- Public base: `/api/masters/location` (no auth, sirf `active` rows, rate-limited 120 req/min/IP)

---

## 1. Admin endpoints (22)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Counts only: `totalContinents/Countries/States/Cities/Pincodes` |
| GET/POST | `/continents` | POST body `{ name, status? }` |
| PATCH/DELETE | `/continents/:id` | DELETE `?force=true` (cascade) `&hard=true` (permanent) |
| GET/POST | `/countries` | GET `?continentId=`; POST `{ name, continentId }` |
| PATCH/DELETE | `/countries/:id` | |
| GET/POST | `/states` | GET `?countryId=`; POST `{ name, countryId }` |
| PATCH/DELETE | `/states/:id` | |
| GET/POST | `/cities` | GET `?stateId=`; POST `{ name, stateId }` |
| PATCH/DELETE | `/cities/:id` | |
| GET | `/pincodes` | `?cityId=` ya `?stateId=` (ab `?countryId=` bhi) |
| GET | `/pincodes/table` | **Flat table** — neeche §2 |
| POST | `/pincodes` | `{ pincode, cityId, prefix?, status? }` |
| PATCH/DELETE | `/pincodes/:id` | |

Common GET query params: `?status=active|inactive|coming_soon` `?search=` `?page=` `?limit=`
(default 500, max 5000). **`?limit=all` pincodes par blocked hai** (19k rows ka dump nahi hoga).

Envelope: `{ success, message, count, total, page, limit, totalPages, data }`.

### Rules (service-enforced)
- Child create/reactivate ke liye parent **exist + active** hona chahiye. Pincode ke liye
  city + state + country **teeno** active check hote hain.
- Duplicate → 409 with hint: `"... (currently inactive — set it to active instead)"`.
  Pincode ab **per-country unique** hai (`{ pincode, countryId }`), city-level nahi.
- DELETE = soft; live children ho to 409 (`?force=true` se cascade), `?hard=true` permanent.
- Invalid ObjectId → 400 (`Invalid <Label> id`) — strict 24-hex check.

## 2. Flat pincode table — `GET /pincodes/table`

Single searchable, paginated table across ALL pincodes with names joined:

`?search=400` (pincode prefix) | `?search=mumbai` (city) | `?search=goa` (state)
`?cityId=` `?stateId=` `?countryId=` `?status=` `?page=` `?limit=` (default 50, max 500)

- Digits → pincode prefix match (indexed). Text → city/state **slug-prefix** match (indexed).
- Har row me `city`, `state`, `country` names bulk-resolve hote hain (page-size independent).
- Returns `totalPages`.

## 3. Public endpoints (6) — rate-limited (120 req/min/IP)

| Method | Path | Notes |
|---|---|---|
| GET | `/pincode/:pincode` | Full place chain (city/state/country/continent + ids) |
| GET | `/pincode?q=&limit=` | Typeahead; digits → pincode, letters → city (max 25) |
| POST | `/pincode/validate` | **Core form check** — neeche §3.1 |
| GET | `/countries` | Active countries (`?continentId=`) |
| GET | `/states?countryId=` | Active states |
| GET | `/cities?stateId=` | Active cities |

Public reads par server hamesha `status: "active"` force karta hai — inactive/coming_soon
row applicant ko kabhi nahi dikhti.

### 3.1 `POST /pincode/validate` — State→City→Pincode verification

Body (names OR ids):
```json
{ "pincode": "400001", "state": "Maharashtra", "city": "Mumbai" }
{ "pincode": "400001", "stateId": "…", "cityId": "…", "strict": true }
```

Well-formed request hamesha HTTP 200 + `valid` flag deta hai (400 sirf malformed par):

| Case | Response |
|---|---|
| Sahi | `{ valid: true, message: "Pincode verified successfully", data: {…place chain} }` |
| Galat pincode (master me nahi) | `{ valid: false, message: "Pincode \"400001\" is wrong. Please provide a correct pincode." }` |
| Doosre state ka pincode | `{ valid: false, message: "Pincode \"403001\" belongs to Goa — not Karnataka. …" }` |
| Doosre city ka pincode | `{ valid: false, message: "… belongs to Mumbai, Maharashtra — not Pune. …" }` |
| Pincode `inactive`/`coming_soon` | `{ valid: false, message: "Pincode \"…\" is inactive/coming soon in our records. …" }` |

`strict: true` → jo city verify hi na ho paye use invalid maano (default: skip, genuine
applicant ko reject na karna).

**coming_soon behavior (updated):** sirf `active` pincode hi validate/lookup hota hai.
`coming_soon` ya `inactive` pin "not serviceable" message deta hai — admin jo bhi
non-active status set kare, public forms turant band ho jaate hain.

### Lookup/typeahead notes
- `GET /pincode/:pincode` → 404: `Pincode "X" is coming soon — not serviceable yet`
  (inactive ke liye "is inactive — not serviceable yet").
- Non-determinism fix: pincode ab per-country unique hai, isliye `findOne` deterministic.

## 4. Data model changes (v1.1)

- `Pincode` ab `countryId` bhi rakhta hai (`countryId, stateId, cityId` denormalized chain).
- Unique index: `{ pincode: 1, countryId: 1 }` (pehle `{ cityId, pincode }` tha).
- `Country` me `isoCode` (ISO 3166-1 alpha-2, e.g. "IN") — importer set karta hai.
- Country/State/City par `{ slug: 1 }` indexes — name searches indexed.
- **Migration note:** purane pincode docs me `countryId` nahi hoga. Fresh import karo:
  `npm run import:location` (collections clear karke).
