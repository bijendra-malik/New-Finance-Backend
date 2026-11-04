# Admin Process & UI — Franchise Plans

How an admin runs franchise investment plans end to end, and exactly what the
admin panel screens should look like.

- API reference: [FRANCHISE-PLANS-API.md](./FRANCHISE-PLANS-API.md)
- Public page that consumes this data: `/franchise` → "Franchise Investment / Plans & fees"

---

## 1. Where it sits in the admin panel

```
Admin panel
└── Franchise
    ├── Applications        ← /api/admin/franchises         (existing)
    ├── Customers           ← /api/admin/franchise-customers (existing)
    └── Plans               ← /api/admin/franchise-plans     (NEW — this feature)
```

**Rule:** the plan list is configuration, not day-to-day operations. It belongs
under Franchise settings, not on the dashboard. Admins touch it a few times a
year — usually when a price changes.

---

## 2. The process

```
1. Draft       admin fills code + name + duration + fee
2. Publish     isActive = true  → appears on /franchise immediately
3. Order       sortOrder decides the card order (3Y first is the current page)
4. Feature     exactly one plan carries the "Best Value" badge
5. Re-price    edit fee anytime — existing partners keep their frozen price
6. Retire      hide (isActive = false) instead of deleting
```

**Step 5 is the important one.** When an admin edits `fee`, the public page
changes instantly for *new* applicants, but every franchise that already applied
keeps the price stored in `franchise.plan` (the snapshot). The admin UI should
say this out loud so nobody panics that history changed:

> Changing the fee updates the published page for new applicants.
> Existing franchise applications keep the price they applied at.

**Step 6** — plans are never hard-deleted. A plan referenced by real
applications must stay resolvable.

---

## 3. Screen 1 — Plans list

Route suggestion: `Franchise → Plans`.
Title: **Franchise Investment Plans**
Subtitle: *Published on indexia-finance-web `/franchise` page.*

### Toolbar

| Control       | Behaviour                                                            |
| ------------- | -------------------------------------------------------------------- |
| Search        | filters on code + name (client-side is fine; 5–10 rows)               |
| Status filter | `All` / `Live` / `Hidden` → `GET /api/admin/franchise-plans?active=`  |
| `+ New Plan`  | opens the create form (primary button)                                |

### Table

| Order | Plan | Code | Validity | Fee (excl. GST) | GST 18% | Total | Renewal | Best Value | Status | Actions |
| ----- | ---- | ---- | -------- | --------------- | ------- | ----- | ------- | ---------- | ------ | ------- |

Rows (from the seeded data):

| Order | Plan           | Code | Validity | Fee       | GST     | Total     | Renewal       | Best Value | Status |
| ----- | -------------- | ---- | -------- | --------- | ------- | --------- | ------------- | ---------- | ------ |
| 1     | 3-Year Plan    | `3Y` | 3 Years  | ₹2,49,000 | ₹44,820 | ₹2,93,820 | ₹4,999        | ★          | Live   |
| 2     | Annual Plan    | `1Y` | 1 Year   | ₹1,19,000 | ₹21,420 | ₹1,40,420 | ₹4,999        |            | Live   |
| 3     | 6-Month Plan   | `6M` | 6 Months | ₹89,000   | ₹16,020 | ₹1,05,020 | ₹4,999        |            | Live   |
| 4     | Quarterly Plan | `3M` | 3 Months | ₹59,000   | ₹10,620 | ₹69,620   | ₹4,999        |            | Live   |
| 5     | Monthly Plan   | `1M` | 1 Month  | ₹24,000   | ₹4,320  | ₹28,320   | ₹4,999        |            | Live   |

Notes for the table:

- Show **Fee** and **Total** as two columns — that is the whole reason GST is
  stored as a percent instead of baked into the fee.
- Show `effectiveMonthlyCost` as a small secondary line under Fee
  ("≈ ₹6,917/mo") — it is the number that justifies the Best Value badge.
- **Best Value** is a single star, not a checkbox per row: clicking it on one row
  clears it everywhere else (the API enforces this too).
- **Status** is a chip: `Live` (green) / `Hidden` (grey).
- Actions: `Edit` · `Pin Best Value` / `Unpin` · `Hide` / `Show` · `Delete`

### Row actions → API

| Action          | Call                                                        |
| --------------- | ----------------------------------------------------------- |
| Load list       | `GET /api/admin/franchise-plans?active=`                     |
| Pin / unpin     | `PATCH /api/admin/franchise-plans/:id/best-value` `{ isBestValue }` |
| Hide / show     | `PATCH /api/admin/franchise-plans/:id/status` `{ isActive }` |
| Delete          | `DELETE /api/admin/franchise-plans/:id`                      |

After **Pin**, refresh the list (or optimistically clear the star on the other
rows) — the server moved the badge, and a stale table would show two stars.

---

## 4. Screen 2 — Create / Edit plan

One form for both. On edit, `code` stays editable but the UI should warn that
changing a code affects reporting that keys off it.

### Fields

| Field            | Control                  | Required | Notes                                                    |
| ---------------- | ------------------------ | -------- | -------------------------------------------------------- |
| Plan code        | text, uppercase          | ✅       | 1–20 chars, letters/numbers/`-`/`_`. e.g. `3Y`. Immutable in practice. |
| Plan name        | text                     | ✅       | Display name — `3-Year Plan`.                             |
| Validity (months)| number                   | ✅       | **Integer ≥ 1** — 36, 12, 6, 3, 1. Drives the "3 Years" label. |
| Fee (excl. GST)  | number, ₹                | ✅       | ₹2,49,000. Never enter the GST-inclusive figure here.     |
| GST %            | number                   | —        | Default 18.                                                 |
| Renewal fee      | editable number, ₹ — or empty | —    | Admin can enter a renewal fee per plan. Defaults to ₹4,999 for all plans. Empty = "As applicable". |
| Renewal note     | text                     | —        | Shown when there is no renewal fee. Default "As applicable". |
| Features         | repeatable text rows     | —        | Max 20 rows, 200 chars each. e.g. "Franchise access for 3 years". |
| Display order    | number                   | —        | Blank on create = appended last.                          |
| Best Value       | toggle                   | —        | Turning it on moves the badge off whichever plan had it.   |
| Live on site     | toggle                   | —        | `isActive`. Default on.                                   |

### Live preview panel (recommended)

Show the exact card the franchise page will render, updating as the admin types:

```
┌─────────────────────────┐
│  BEST VALUE — 3 YEARS   │
│  3-Year Plan            │
│  3 YEARS                │
│  ₹2.49 Lakh + GST       │
│  • Franchise access for 3 years
│  Renewal: ₹4,999        │
└─────────────────────────┘
```

This removes almost all support questions, because the admin sees the fee
formatting ("₹2.49 Lakh"), the derived validity badge and the renewal line
exactly as the public sees them.

**Compute nothing client-side.** The preview should use `validityLabel`,
`totalWithGst` and `renewalText` from the API response — not its own arithmetic.
Two implementations of the same number is how a page ends up showing ₹2.49 Lakh
while the record stores something else.

### Submit → API

| Action   | Call                                                |
| -------- | --------------------------------------------------- |
| Create   | `POST /api/admin/franchise-plans`                    |
| Edit     | `PATCH /api/admin/franchise-plans/:id` (changed fields only) |

Send only the changed fields on edit — the API treats every field as optional.

---

## 5. Confirmation dialogs (copy to use)

**Hide a plan**

> **Hide "Quarterly Plan"?**
> It will disappear from the franchise page immediately. Existing applications
> keep their recorded price, and you can show it again anytime.

**Delete a plan**

> **Delete "Quarterly Plan"?**
> The plan will be hidden from the website. It is not erased, because existing
> franchise applications reference it.

**Change a fee**

> **Update fee to ₹2,59,000?**
> New applicants will see the new price. The 4 franchises who already applied
> keep ₹2,49,000 in their records.

---

## 6. Errors the UI must surface

| Server response                  | UI message                                                       |
| -------------------------------- | ---------------------------------------------------------------- |
| `409 Plan code "3Y" already exists` | inline on the Code field — "This code is already used"           |
| `400 At least one franchise plan must stay active` | toast — "The franchise page needs at least one live plan" |
| `400` field validation           | inline, next to the field; the API returns `errors[]`            |
| `409 Plan "3M" is already inactive` | toast — "That plan is already hidden"                          |
| `401`                            | send the admin back to login                                     |
| `404`                            | "This plan no longer exists" + refresh the list                  |

The API always answers `{ success: false, message }` — show `message` verbatim
where there is no better copy, and use the field-level `errors[]` for inline
validation.

---

## 7. Rules the UI must respect

1. **Never** compute GST or the monthly cost in the browser — read `gstAmount`,
   `totalWithGst`, `effectiveMonthlyCost`.
2. **Never** hardcode `3Y` as the Best Value plan — use `bestValueCode`.
3. **One star at a time.** After pinning, refresh or clear the other rows.
4. **Don't offer a "hard delete".** Hide is the only safe removal.
5. **Don't leave zero live plans.** The API blocks it; the UI should disable
   `Hide` on the last live row rather than let the admin hit an error.
6. **`code` is a reporting key.** Warn on edit, don't let it be blanked.

---

## 8. Standard-level checklist

| Concern              | Expected behaviour                                                        |
| -------------------- | ------------------------------------------------------------------------- |
| Loading              | skeleton rows, not a blank table                                          |
| Empty state          | "No plans yet — your franchise page is showing no pricing." + `+ New Plan` |
| Error state          | retry button, never a silent blank                                        |
| Permissions          | visible only to admins who may edit franchise configuration               |
| Audit                | `createdBy` / `updatedBy` are stored — show "Last updated by X on <date>" |
| Destructive actions  | confirmation dialog, never a single click                                 |
| Money formatting     | `toLocaleString('en-IN')` → ₹2,49,000; page-style short form ₹2.49 Lakh    |
| GST display          | always show fee and GST-inclusive total separately                        |
| Accessibility        | every action reachable by keyboard; star toggle has `aria-pressed`         |
| Optimistic updates   | allowed, but re-fetch after pin/status/delete to stay truthful             |

---

## 9. What the admin controls vs. what stays hardcoded

Managed by this feature (public `GET /api/franchise/plans`):

- plan list, names, fees, GST %, validity, renewal, features, order, badge, visibility

Still hardcoded in the frontend (separate work):

- payout ceilings (Unsecured up to 4%, Secured up to 2.4%)
- the 80/20 revenue split and the ₹1,00,000 illustration
- the ₹30,000 + GST franchisee agreement fee
- franchise FAQs

Those are the next pieces to move behind the same pattern.
