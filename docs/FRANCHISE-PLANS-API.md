# Franchise Plans API

The **Franchise Investment** plans shown on the `/franchise` page ("Plans & fees")
used to be hardcoded in the frontend. They are now documents in their own
collection, managed by the admin and read by the public site.

```
Admin panel  ──►  /api/admin/franchise-plans   (CRUD, admin JWT)
                        │
                        ▼
                 `franchiseplans` collection
                        │
                        ▼
Franchise page ──►  /api/franchise/plans       (public, active plans only)
                        │
                        ▼
Franchise apply ──►  POST /api/franchise/apply  (planCode → frozen snapshot)
```

---

## 1. What is stored

Collection: `franchiseplans` (Mongoose model `FranchisePlan`,
`src/modules/franchise/franchisePlan.model.js`).

| Field            | Type       | Notes                                                        |
| ---------------- | ---------- | ------------------------------------------------------------ |
| `code`           | String     | Stable public id — `3Y`, `1Y`, `6M`, `3M`, `1M`. Unique.      |
| `name`           | String     | Display name — `3-Year Plan`.                                 |
| `durationMonths` | Number     | **Source of truth for validity** — 36 / 12 / 6 / 3 / 1.       |
| `fee`            | Number     | **GST-exclusive** base fee in rupees — `249000`.              |
| `currency`       | String     | Default `INR`.                                                |
| `gstPercent`     | Number     | Default `18`.                                                 |
| `renewalFee`     | Number     | Admin-editable fixed renewal amount (default `4999` for all seeded plans) or `null`. |
| `renewalNote`    | String     | Used when `renewalFee` is `null` — `"As applicable"`.         |
| `features`       | [String]   | UI bullets — `"Franchise access for 3 years"`.                 |
| `isBestValue`    | Boolean    | "Best Value" badge. **At most one plan** can hold it.         |
| `isActive`       | Boolean    | Soft delete — inactive plans disappear from the public list.  |
| `sortOrder`      | Number     | Display order. Lower first.                                   |
| `createdBy` / `updatedBy` | ObjectId | Admin audit.                                        |

`code` and `durationMonths` deliberately never drift apart: the validity label
in the response is derived from `durationMonths`, not from `name`.

### Derived fields (never stored)

Every response is enriched by `withDerivedFields()` in
`src/modules/franchise/franchisePlan.service.js`:

| Field                    | Formula                              | 3Y example |
| ------------------------ | ------------------------------------ | ---------- |
| `validityLabel`          | from `durationMonths`                | `3 Years`  |
| `gstAmount`              | `fee * gstPercent / 100`             | `44820`    |
| `totalWithGst`           | `fee + gstAmount`                    | `293820`   |
| `effectiveMonthlyCost`   | `fee / durationMonths`               | `6916.67`  |
| `effectiveMonthlyWithGst`| `totalWithGst / durationMonths`      | `8161.67`  |
| `renewalText`            | `renewalFee` ? `"₹4,999"` : `renewalNote` | `₹4,999` |

Because `fee` is GST-exclusive, changing the GST rate later is a one-row edit
and the GST amount stays separable for reporting.

---

## 2. Public API

### `GET /api/franchise/plans`

No auth. Returns **active** plans only, sorted by `sortOrder`.

Optional: if a valid franchise token is sent, the response includes that
franchise's chosen plan as `selectedPlanCode` (the UI's `Selected ✓`). An
invalid or expired token is ignored — this endpoint never returns 401.

```json
{
  "success": true,
  "count": 5,
  "bestValueCode": "3Y",
  "bestValueIsPinned": true,
  "selectedPlanCode": null,
  "plans": [
    {
      "_id": "68f...",
      "code": "3Y",
      "name": "3-Year Plan",
      "durationMonths": 36,
      "fee": 249000,
      "currency": "INR",
      "gstPercent": 18,
      "gstAmount": 44820,
      "totalWithGst": 293820,
      "effectiveMonthlyCost": 6916.67,
      "effectiveMonthlyWithGst": 8161.67,
      "renewalFee": 4999,
      "renewalNote": "As applicable",
      "renewalText": "₹4,999",
      "validityLabel": "3 Years",
      "features": ["Franchise access for 3 years"],
      "isBestValue": true,
      "isActive": true,
      "sortOrder": 1
    }
  ]
}
```

**How `bestValueCode` is decided**

1. If an admin pinned a plan with `isBestValue: true`, that plan wins.
2. Otherwise the plan with the lowest `effectiveMonthlyCost` is used.

The fallback exists so the badge can never disappear, and so the sentence on
the page — *"the 3-year plan carries the lowest effective monthly cost"* —
stays true even if the badge is never pinned.

---

## 3. Admin API

All endpoints require an admin JWT (`Authorization: Bearer <token>`), same as
every other `/api/admin/*` route.

| Method   | Path                                       | Purpose                                   |
| -------- | ------------------------------------------ | ----------------------------------------- |
| `GET`    | `/api/admin/franchise-plans`               | All plans (`?active=true\|false`)         |
| `POST`   | `/api/admin/franchise-plans`               | Create a plan                             |
| `GET`    | `/api/admin/franchise-plans/:id`           | One plan                                  |
| `PATCH`  | `/api/admin/franchise-plans/:id`           | Edit fee / validity / renewal / features / order |
| `PATCH`  | `/api/admin/franchise-plans/:id/best-value`| Pin or unpin the "Best Value" badge       |
| `PATCH`  | `/api/admin/franchise-plans/:id/status`    | `{ "isActive": false }` → hide from the page |
| `DELETE` | `/api/admin/franchise-plans/:id`           | Soft delete (deactivates, keeps the record) |

**Create**

```http
POST /api/admin/franchise-plans
Content-Type: application/json

{
  "code": "2Y",
  "name": "2-Year Plan",
  "durationMonths": 24,
  "fee": 189000,
  "gstPercent": 18,
  "renewalFee": 4999,
  "renewalNote": "As applicable",
  "features": ["Franchise access for 2 years"],
  "isBestValue": false,
  "sortOrder": 2
}
```

`fee`, `name`, `durationMonths` and `code` are required. Admins can enter a
non-negative numeric `renewalFee` when creating or editing any plan; sending
`null` shows `renewalNote` instead. Status: `201`.

**Edit** — send only what changed:

```http
PATCH /api/admin/franchise-plans/:id
{ "renewalFee": 7500 }
```

**Pin the badge** (unpins whatever held it):

```http
PATCH /api/admin/franchise-plans/:id/best-value
{ "isBestValue": true }
```

### Errors

| Status | When                                                                    |
| ------ | ----------------------------------------------------------------------- |
| `400`  | Validation failed, `durationMonths < 1`, negative fee, or deactivating the last active plan |
| `401`  | Missing / invalid admin token                                            |
| `403`  | Valid token but not an admin token                                        |
| `404`  | Unknown plan id                                                          |
| `409`  | Duplicate `code`, or deactivating an already-inactive plan                |

---

## 4. Apply flow — the plan freeze

`POST /api/franchise/apply` now accepts **`planCode`** in addition to the legacy
free-text `package`:

```json
{
  "panNumber": "ABCDE1234F",
  "state": "Uttar Pradesh",
  "city": "Noida",
  "planCode": "3Y",
  "businessName": "Amit Enterprises"
}
```

Rules:

- Sending **neither** `planCode` nor `package` → `400 Please select a franchise plan before applying`.
- `planCode` must resolve to an **active** plan, else `400`.
- The chosen plan is written to the franchise document as a **snapshot**
  (`franchise.plan`), not just a reference:

```json
"plan": {
  "plan": "68f...",
  "code": "3Y",
  "name": "3-Year Plan",
  "durationMonths": 36,
  "fee": 249000,
  "gstPercent": 18,
  "gstAmount": 44820,
  "totalWithGst": 293820,
  "renewalFee": 4999,
  "renewalNote": "As applicable",
  "snapshotAt": "2026-10-10T09:12:00.000Z"
}
```

**Why a snapshot instead of only an ObjectId?** Plans get re-priced. A partner
who signed up at ₹2.49 Lakh must keep ₹2.49 Lakh in their record even after the
admin changes the plan. A bare reference would silently rewrite history.

`franchise.package` is still kept in sync with `plan.name` for older records and
clients. Applications sent with only `package` keep working exactly as before
and simply have no `plan` snapshot.

---

## 5. Setup

```bash
npm run seed:franchise-plans
```

The seed is **idempotent** and uses `$setOnInsert`, so re-running it never
overwrites a fee or validity the admin has edited. It only creates plans that
are missing, and sets the "Best Value" badge only if no plan holds it yet.

After deploying the ₹4,999 defaults, run the one-time migration to update
existing standard plans:

```bash
npm run migrate:franchise-renewal-fee
```

This sets the renewal fee to ₹4,999 for the five standard plan codes only.
It intentionally overwrites renewal fees currently configured on those plans;
custom plan codes and existing franchise enrollment snapshots are not changed.
After migration, admins can edit each standard plan's renewal fee through the
admin API without routine seed runs overwriting those choices.

Seeded plans (matching the published page):

| Order | Code | Name           | Validity | Fee (excl. GST) | Renewal       |
| ----- | ---- | -------------- | -------- | --------------- | ------------- |
| 1     | `3Y` | 3-Year Plan    | 3 Years  | ₹2,49,000       | ₹4,999        |
| 2     | `1Y` | Annual Plan    | 1 Year   | ₹1,19,000       | ₹4,999        |
| 3     | `6M` | 6-Month Plan   | 6 Months | ₹89,000         | ₹4,999        |
| 4     | `3M` | Quarterly Plan | 3 Months | ₹59,000         | ₹4,999        |
| 5     | `1M` | Monthly Plan   | 1 Month  | ₹24,000         | ₹4,999        |

---

## 6. Frontend migration

The page can keep rendering exactly as it does today; two changes are needed:

1. Replace the hardcoded plan array with `GET /api/franchise/plans`.
2. Send `planCode` (not `package`) from the apply form.

Notes for the UI:

- Use `bestValueCode` for the "Best Value — 3 Years" badge instead of hardcoding `3Y`.
- Use `selectedPlanCode` for the `Selected ✓` state when a franchise is logged
  in; for a logged-out visitor the pre-selection is a UI choice.
- `fee`, `gstAmount` and `totalWithGst` are numbers — format them (the existing
  page shows "₹2.49 Lakh", which is a display decision, not an API one).
- `renewalText` is already display-ready: `"₹4,999"` or `"As applicable"`.

---

## 7. Related, not yet built

These sit on the same page but are **separate** config/APIs:

- Payout ceilings (Unsecured up to 4%, Secured up to 2.4%) and the 80/20 split.
- The ₹30,000 + GST franchisee agreement fee.
- Franchise FAQs.

They are still hardcoded in the frontend today.
