# ADMIN API — poora reference (live verified)

**Ye doc kab verify hua:** 15 Oct 2026 · `http://localhost:5000` par chalta hua server
**Kaise verify hua:** ek script ne admin login se lekar poora review flow chalaya —
**47/47 checks pass** (har endpoint ka status code + kaam check kiya, aur jo test
application banayi thi wo approve → delete karke cleanup bhi kiya).

Header sab jagah: `Authorization: Bearer {{adminToken}}` + `Content-Type: application/json`
Login ke alawa **har** `/api/admin/...` call me ye token chahiye.

---

## 0. Token — kaise milega, kaun chalega

```
POST {{BASE_URL}}/api/admin/auth/login        (PUBLIC — token nahi chahiye)
{ "email": "admin@indexiafinance.com", "password": "<ADMIN_SEED_PASSWORD>" }
```
**Credentials note:** is .env me `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` **khaali** hain,
isliye seed script ka default chalta hai -> `admin@indexiafinance.com` / `Admin@123`
(dekho `scripts/seedAdmin.js`). Production me dono .env me set karke password badal do.

**200:**
```json
{ "success": true, "message": "Login successful", "token": "eyJhbGciOi...", "admin": { "_id": "...", "name": "Super Admin", "email": "admin@indexiafinance.com", "role": "SuperAdmin" } }
```

Rules (live verify kiye):

| Case | Result |
|---|---|
| Token nahi | `401 Unauthorized` |
| Galat password | `401` |
| Invalid token | `401 Invalid Token` |
| **Customer / franchise ka token** | `403 Forbidden: Admin access only` |

Wajah: admin JWT me `type: "admin"` hota hai, aur `middleware/adminAuth.middleware.js`
yahi check karta hai. Isliye admin session customer session se alag rehta hai —
customer ka token admin APIs par kabhi nahi chalega.

### Customer aur loan-product permissions

Super Admin ko hamesha sabhi sections dikhte hain. Normal Admin ke liye
`moduleAccess: ["customers"]` customer workspace kholta hai: wahan wo sabhi
customers ki listing aur customer profile dekh sakta hai. Iske liye
`loanAccess` me koi product dena zaroori nahi hai. Customer workspace se loan
applications ya product details nahi dikhti; `/customers/:id/applications`
sirf Super Admin access kar sakta hai.

`loanAccess` sirf product-wise loan workspaces ko control karta hai. Normal
Admin un workspaces me sirf assigned product slugs dekh/handle kar sakta hai;
customer workspace ka access un loan permissions ko grant nahi karta. Empty
`loanAccess` ka matlab koi product workspace access nahi. Franchise applications
alag workflow me hain aur sirf Super Admin ko dikhte hain. Permissions har
authenticated request par database se dobara load hoti hain, isliye Super
Admin ke changes token renew kiye bina lagu hote hain.

Normal Admin ko apne assigned products ki rejected **direct customer**
applications product lists/details, dashboard aur `/api/admin/rejected-loans`
me dikhte hain. Franchise-customer rejected applications, score-only
rejections aur rejected franchise applications sirf Super Admin ko dikhte
hain. `/api/admin/rejected-loans` assigned product permissions ka bhi palan
karta hai.

---

## 1. Flow — admin ka kaam kis order me aata hai

```
CUSTOMER SIDE                                ADMIN SIDE
────────────────────────────────────────     ────────────────────────────────────
POST /api/auth/:product   (details + OTP)
POST /api/auth/verify-otp (account + CUST id + token)
GET  /api/customer/loan-apply   (fields+prefill)
POST /api/customer/loan-apply   ──────────▶  status = "Submitted"
                                             GET  /api/admin/dashboard/stats
                                             GET  /api/admin/personal-loans
                                             GET  /api/admin/personal-loans/:id
                          ◀──────────────    PATCH .../:id/status { "Pending", note }
GET /api/customer/loans/LOAN000001           → customer ko "Under Review" (step 2)
                          ◀──────────────    PATCH .../:id/status { "Approved", note }
                                             → customer ko "Approved" + adminNote
                                             (is ke baad status lock — koi badlav 409)
                                             DELETE /api/admin/personal-loans/:id
                          ◀──────────────    → customer dobara apply kar sakta hai
```

**Franchise ka alag darwaza** (customer se mila hua nahi):

```
POST /api/franchise/entry + verify        → account + franchiseStatus = Pending
                                            (admin: GET /api/admin/franchises?status=Pending)
PATCH /api/admin/franchises/:id/approve   → FRN000125 mint + PAN number password
POST /api/franchise/login (FRN + PAN)     → franchise token
POST /api/franchise/customer/:product/applyloan → franchise ke customer ka loan
                                            (admin: GET /api/admin/franchise-customers)
```

### Status rules (code me enforced — `loans/shared/loanStatus.js`)

| Current status | Kahan ja sakta hai |
|---|---|
| `Submitted` | `Pending`, `Approved`, `Rejected` |
| `Pending` | `Approved`, `Rejected` |
| `Approved` | kuch nahi (locked) |
| `Rejected` | kuch nahi (locked) |

| Galat request | Response |
|---|---|
| Wahi status dobara | `409 This application is already <status>` |
| Terminal ke baad badlav | `409 Application is already <status> — its status can no longer be changed` |
| `status` unknown/missing | `400 Status must be one of: Pending, Approved, Rejected` |
| `note` 500+ chars | `400 Note is too long (max 500 characters)` |

Approved/Rejected par `approvedBy` (admin id) + `approvedAt`/`rejectedAt` + `adminNote`
stamp hote hain — aur wahi `adminNote` customer ko uske status API me dikhta hai.

---

## 2. Saare endpoints

### A. Admin auth — `/api/admin/auth`

| Method | Path | Kaam |
|---|---|---|
| POST | `/login` | email + password → token (public) |
| POST | `/forgot-password` | email par OTP |
| POST | `/reset-password` | email + otp + newPassword |
| GET | `/profile` | apna admin record → `{ success, admin }` |
| PUT | `/profile` | name / email update |
| PUT | `/change-password` | currentPassword + newPassword |

### B. Dashboard

| Method | Path | Kaam |
|---|---|---|
| GET | `/api/admin/dashboard/stats` | ek hi request me poora dashboard (15 requests ki jagah) |

Verified response (aaj ke numbers):
```json
{
  "success": true,
  "stats": {
    "totalCustomers": 15, "totalFranchises": 12,
    "totalApplications": 147,
    "submitted": 142, "pending": 2, "approved": 2, "rejected": 1,
    "requestedAmount": 4866421686, "approvedAmount": 1000500000,
    "approvalRate": 66.67,
    "products": [
      { "resource": "personal-loans", "label": "Personal loan", "total": 11, "Submitted": 7, "Pending": 2, "Approved": 1, "Rejected": 1, "requestedAmount": 5500000, "approvedAmount": 500000 },
      { "resource": "business-loans", "label": "Business loan", "total": 1, "Submitted": 1, "Pending": 0, "Approved": 0, "Rejected": 0, "requestedAmount": 500000, "approvedAmount": 0 },
      "...kul 18 rows..."
    ],
    "recent": [
      { "_id": "...", "resource": "personal-loans", "product": "Personal loan", "applicantName": "Rahulcustomers01", "mobile": "9999999900", "loanType": "Personal Loan", "status": "Submitted", "loanAmount": 500000, "createdAt": "2026-10-15T05:57:32.672Z" },
      "...top 10..."
    ],
    "generatedAt": "2026-10-15T07:16:24.000Z"
  }
}
```
`products` = 18 rows (product-wise counts + amounts), `recent` = sab products ka top 10.
`totalFranchises` sirf Super Admin response mein hota hai; regular Admin response
mein ye field omit hota hai.

### C. Loan applications — 18 resources × 4 endpoints (har resource par same)

```
GET    /api/admin/{resource}                 sab applications (newest first)
GET    /api/admin/{resource}/:id             ek application (raw document)
PATCH  /api/admin/{resource}/:id/status      { status, note? }  → review decision
DELETE /api/admin/{resource}/:id             ek application delete (reset tool)
```

| Resource (URL) | Product | Aaj kitne |
|---|---|---|
| `personal-loans` | Personal Loan | 11 |
| `business-loans` | Business Loan | 1 |
| `home-loans` | Home Loan | 23 |
| `loan-against-properties` | Loan Against Property | 12 |
| `balance-transfers` | Balance Transfer | 6 |
| `project-loans` | Project Loan | 7 |
| `vehicle-loans` | Vehicle Loan | 2 |
| `education-loans` | Education Loan | 11 |
| `credit-cards` | Credit Card | 10 |
| `working-capitals` | Working Capital | 10 |
| `commercial-purchases` | Commercial Purchase | 9 |
| `lease-rental-discountings` | Lease Rental Discounting | 9 |
| `od-cc-limits` | OD / CC Limit | 10 |
| `loan-against-shares` | Loan Against Share | 5 |
| `npa-loans` | NPA Loan | 6 |
| `gold-loans` | Gold Loan | 5 |
| `fdi-loans` | FDI Loan | 4 |
| `film-fundings` | Film Funding | 6 |

List response: `{ "success": true, "loans": [ ...raw documents... ] }`
Detail response: `{ "success": true, "loan": { ...raw document... } }`
(Admin ko **raw** document milta hai — `sections` wala trimmed view sirf customer API me
jaata hai, taaki admin ke paas poora record rahe.)

PATCH response: `{ "success": true, "message": "Personal loan application marked approved", "loan": { ...updated document... } }`

### D. Customers — `/api/admin/customers`

| Method | Path | Kaam |
|---|---|---|
| GET | `/` | list (`?search=&page=&limit=&isActive=true|false`) |
| GET | `/:id` | ek customer |
| GET | `/:id/applications` | sirf Super Admin: uske SAARE products ki applications, product-wise grouped |
| PATCH | `/:id/status` | `{ isActive: true|false }` |
| DELETE | `/:id` | customer delete — **open application ho to 409** |

Regular Admin ko `moduleAccess: ["customers"]` se sirf customer listing aur
profile access milta hai; uske paas `loanAccess` empty ho sakta hai. Loan
applications dekhne ke liye Super Admin role chahiye.

`GET /:id/applications` (Super Admin only) ka response:
```json
{
  "success": true,
  "customer": { "_id": "...", "name": "Rahulcustomers02", "email": "...", "mobile": "9999999902" },
  "total": 2,
  "data": [ { "product": "personal", "count": 1, "applications": [ "..." ] } ]
}
```
Customer delete rules: `Submitted`/`Pending` application bachi ho to `409` (pehle decide karo),
warna customer + uski closed history ek saath delete ho jaati hai.

### E. Franchises — `/api/admin/franchises`

Ye franchise management endpoints, franchise plans, aur franchise-customer
network view **sirf Super Admin** ke liye hain. Normal Admin ko in paths par
`403` milega. Franchise accounts aur unke loans customer APIs se alag process
hote hain; `/api/admin/customers` me franchise account ko customer ke roop me
nahi dikhaya jaata.

| Method | Path | Kaam |
|---|---|---|
| GET | `/` | list (`?status=Pending&search=&page=&limit=`) |
| GET | `/:id` | ek franchise (plan snapshot + business details) |
| PATCH | `/:id/approve` | approve → **FRN000125** mint + PAN number initial password |
| PATCH | `/:id/reject` | reject `{ note? }` |
| PATCH | `/:id/reset-password` | PAN se password dobara hash |
| GET | `/:id/loans` | is FRN ke through aayi applications |

### F. Franchise plans — `/api/admin/franchise-plans`

| Method | Path | Kaam |
|---|---|---|
| GET | `/` | list (`?active=true|false`) |
| POST | `/` | naya plan (code optional — duration se ban jaata hai) |
| GET | `/:id` | ek plan |
| PATCH | `/:id` | fee / validity / renewal / features / order |
| PATCH | `/:id/best-value` | "Best Value" badge pin/unpin |
| PATCH | `/:id/status` | `{ isActive }` franchise page par dikhana/band |
| DELETE | `/:id` | soft delete (deactivate) |

### G. Franchise customers (read-only network view) — `/api/admin/franchise-customers`

| Method | Path | Kaam |
|---|---|---|
| GET | `/stats` | network-wide count (franchise-wise) |
| GET | `/` | saare franchise customers (`?search=&franchise=&page=&limit=`) |
| GET | `/:id` | ek customer + owner franchise + loan status |

### H. Masters — `/api/admin/masters`

| Method | Path | Kaam |
|---|---|---|
| GET | `/` | saare grouped masters |
| POST | `/` | naya master group |
| POST | `/custom` | custom value add |
| GET/POST/PUT/DELETE | `/banks` (+ `DELETE /banks/:name`) | banks master |
| GET/POST/PUT/DELETE | `/banksdetails` (+ `/:value`) | Bank Details page |
| GET/POST | `/states` | states + `GET /states/:state/cities`, `/:city/pincodes` |
| PUT/DELETE | `/states/:state`, `/states/:state/cities/:city` | edit/delete |
| GET | `/cities`, `/pincodes` | flat lists |
| GET/PUT/DELETE | `/:id` (+ `PUT /:id/values`) | ek master group |

### I. Location master — `/api/admin/masters/location`

| Method | Path |
|---|---|
| GET | `/` (sirf counts) |
| GET/POST/PATCH/DELETE | `/continents`, `/countries`, `/states`, `/cities`, `/pincodes` |
| GET | `/pincodes/table` (flat, paginated, searchable — city/state/country naam ke saath) |

DELETE par `?force=true&hard=true` bhi chalta hai (continent/country ke children handle karne ke liye).

**Note:** location ka **public** version bhi hai — `/api/masters/location/...` (bina admin
token, frontend ke dropdown/pincode-autofill ke liye, `modules/masters/master.routes.js`
se mount hota hai). Admin wala `/api/admin/masters/location/...` wahi data edit karta hai;
dono ko mix na karo — admin endpoints par token chahiye, public par nahi.

---

## 3. Ready examples (yahi live chalaye the)

```http
### 1) Admin login
POST {{BASE_URL}}/api/admin/auth/login
Content-Type: application/json

{ "email": "admin@indexiafinance.com", "password": "<ADMIN_SEED_PASSWORD>" }

### 2) Dashboard
GET {{BASE_URL}}/api/admin/dashboard/stats
Authorization: Bearer {{adminToken}}

### 3) Applications list (kisi bhi product ki)
GET {{BASE_URL}}/api/admin/personal-loans
Authorization: Bearer {{adminToken}}

### 4) Ek application
GET {{BASE_URL}}/api/admin/personal-loans/{{applicationId}}
Authorization: Bearer {{adminToken}}

### 5) Under review daalo
PATCH {{BASE_URL}}/api/admin/personal-loans/{{applicationId}}/status
Authorization: Bearer {{adminToken}}

{ "status": "Pending", "note": "Documents check ho rahe hain" }

### 6) Approve
PATCH {{BASE_URL}}/api/admin/personal-loans/{{applicationId}}/status
Authorization: Bearer {{adminToken}}

{ "status": "Approved", "note": "Approved — amount 2 lakh" }

### 7) Application hatao (customer ko dobara apply karne dena ho to)
DELETE {{BASE_URL}}/api/admin/personal-loans/{{applicationId}}
Authorization: Bearer {{adminToken}}
```

---

## 4. Admin panel me kya hona chahiye (iss code ke hisaab se)

1. **Login + session** — email/password login, token localStorage/secure store me,
   `401/403` par login screen par wapas. Forgot password (email OTP) + change password.
2. **Dashboard** — `GET /dashboard/stats` se ek call me: totals (customers, franchises,
   applications, submitted/pending/approved/rejected, approval rate), 18-product table,
   aur "recent 10" list (applicant name + mobile + product + status + amount).
3. **Applications screens** — 18 products ke tabs; har tab par status chips
   (Submitted / Pending / Approved / Rejected), search (applicationNo / naam / mobile),
   list → detail drawer.
4. **Detail drawer (sabse zaroori screen)** — dikhana chahiye:
   - applicant ki **verified identity** (name, mobile, email, DOB, PAN) + `customerId` (CUST000027)
   - loan basics (amount, tenure, employmentType) aur section-wise fields
   - channel: `franchise: null` = **Direct customer**, warna `franchiseCode` (FRN…)
   - status timeline (Submitted → Under Review → Approved/Rejected) + `adminNote`
   - actions: sirf **allowed** buttons (Submitted → Pending/Approve/Reject;
     Pending → Approve/Reject; terminal par kuch nahi). UI me bhi lock rakho —
     warna user ko 409 dekhna padega.
5. **Customers** — list + search, detail me CUST id / PAN / DOB / mobile, uski saari
   applications (product-wise), activate/deactivate, delete (open application ho to
   UI me hi rok do, kyunki API 409 degi).
6. **Franchises** — pending queue (approve → FRN + password info, reject with note),
   approved list, reset-password, "is FRN ke loans" tab.
7. **Franchise plans** — CRUD + best value + activate/deactivate.
8. **Franchise customers** — network-wide view (franchise-wise count + customer detail).
9. **Masters** — dropdown values, banks, aur location master (continent → country →
   state → city → pincode).

---

## 5. Jo abhi missing hai (recommend)

1. **Application list me pagination + filters** — abhi har resource `Model.find()` se
   **poora collection** deta hai (aaj 23 home-loans theek hai, 5000 par ye dikkat degi).
   Chahiye: `?status=&search=&page=&limit=&from=&to=`, aur response me `total`.
2. **Detail me applicant ka verified identity + sections + channel ek saath** — abhi admin
   ko raw document milta hai (sahi hai), par customer ka account (CUST id, verified
   email/DOB/PAN) `user` id ke roop me aata hai — ek `?populate=customer` jaisa option ya
   response me `customer` block jodna admin ke liye kaam aasan kar dega.
   (Note: `sections` sirf customer API me banta hai — admin ke liye wahi grouped view
   dobara banana padega.)
3. **Kaun admin, kab** — abhi sirf `approvedBy` (admin id) + timestamp hai; separate
   audit log (kaun kaunsa status change, purana → naya) hone se financial trail poori hogi.
4. **Franchise-wise / date-range dashboard drilldown** + **CSV export**.
5. **Purane documents me `applicationNo` nahi hai** (live data me home-loans ki kuch entries
   me sirf `_id` dikha) — admin UI me uske liye fallback (`LOAN…` na ho to short id) ya ek
   backfill script chahiye.
