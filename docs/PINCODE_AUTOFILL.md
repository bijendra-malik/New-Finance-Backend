# Pincode auto-import & lookup layers

## Import (one command)

```bash
npm run import:location                    # India full (default)
npm run import:location -- --states=goa    # sirf kuch states
npm run import:location -- --countries=IN,AE
npm run import:location -- --skip-cities --skip-pincodes
npm run import:location -- --dry-run
```

- Datasets (devDeps): `india-pincode-lookup` (19,097 unique pincodes) + `country-state-city`.
- **Idempotent** — `$setOnInsert` upserts; admin ne jo deactivate kiya wo deactivated rahega.
- Cities = India Post districts (design decision; towns admin panel se add karo).
- Duplicate post-office rows (same pincode, 2 districts) → first-pincode-wins.
- Pincode rows `countryId` carry karti hain; upsert filter `{ pincode, countryId }`.
- Country upsert `isoCode` bhi store/backfill karta hai (IN, AE, ...).

## Performance (measured on FULL India data: 19,097 pincodes, 36 states, 627 cities)

- **In-memory cache (D2 done):** resolved pincode chains process-local Map me cache hoti
  hain (5-min TTL + 25k entries cap). Repeat lookup **~5-13ms** hota hai (bina cache
  ~150-275ms on the remote DB — network round-trip bound, queries khud 0ms hain).
  **Admin ka koi bhi write (create/update/delete, kisi bhi level par) cache turant
  invalidate karta hai**, isliye deactivate karte hi public forms me asar instant hota
  hai — live verified. Sirf positive (found + serviceable) chains cache hoti hain,
  isliye naya import kabhi stale "not found" nahi deta. Importer / direct-DB writes ke
  liye 5-min TTL safety net hai.
- **Round-trip batching:** validate me state/city dono lookups ek parallel batch me
  udte hain; typeahead ka letters-path city names pehli query ke saath hi le aata hai.
- **Indexes:** `{ pincode, countryId }` unique (public lookup), `{ slug }` (name-prefix
  searches), `{ cityId, status }` / `{ stateId, cityId, status }` (admin filters) —
  koi collection scan nahi.

## Lookup layers (public, rate-limited 120/min/IP)

1. `GET /pincode/:pincode` — user pincode type kare → city/state/country/continent + ids.
   Sirf `active` pin resolve hota hai; `coming_soon`/`inactive` → "not serviceable yet".
2. `GET /pincode?q=` — typeahead. Digits → pincode prefix, letters → city **slug-prefix**
   (indexed). Max 25 suggestions.
3. `POST /pincode/validate` — applicant form ka core check: State→City selected hai,
   pincode typed hai; backend verify karta hai ki wo pincode USI place ka hai. Details:
   docs/LOCATION_MASTER_API.md §3.1.
4. `GET /countries | /states?countryId= | /cities?stateId=` — sirf active rows.

## Admin side handling

- `/api/admin/masters/location/pincodes/table` — flat, searchable, paginated (50/500)
  table with city/state/country names; `?search=` digits→pincode, text→city/state slug.
- Pincode create par service khud city→state→country chain resolve karke teeno ids set
  karta hai aur teeno ke active hone ki guarantee deta hai.
- Deactivate city/state/pincode → turant public forms se gayab (soft delete cascade with
  `?force=true`) — cache invalidation ki wajah se ye INSTANT hai.
