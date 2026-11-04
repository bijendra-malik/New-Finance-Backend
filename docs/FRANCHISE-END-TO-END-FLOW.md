# Franchise — poora end-to-end flow (naya franchise → approve → login → customer → loan)

Har step **live server (port 5000) par chalaya gaya hai** aur neeche ke JSON asli
response se liye gaye hain (test records baad me delete kar diye gaye).

Do alag "gates" yaad rakho:

| Gate | Kahan | Kya hone par khulta hai |
|------|-------|-------------------------|
| **Approval gate** | `POST /api/franchise/customer/*`, `GET /api/franchise/loans` | Admin ne approve kiya (status `Approved`) |
| **Verification gate** | `POST /api/franchise/customer/:product/applyloan` | Us customer ka mobile OTP verify hua (`isVerified: true`) |

Register karna = approve hona **nahi**. Aur customer register karna = uske naam par
loan file hona **nahi** — OTP zaroori hai.

---

## Stage 0 — Admin plans publish karta hai (franchise ke liye public list)

```http
GET /api/franchise/plans            (public, koi token nahi)
```
```json
{
  "success": true,
  "plans": [
    { "code": "3Y", "name": "3-Year-Plan", "durationMonths": 36, "fee": 249000,
      "gstPercent": 18, "gstAmount": 44820, "totalWithGst": 293820,
      "validityLabel": "3 Years", "effectiveMonthlyCost": 6916.67,
      "renewalText": "₹4,999", "isActive": true },
    { "code": "1M", "name": "Monthly Plan", "fee": 24000, "totalWithGst": 28320 }
  ],
  "bestValueCode": "3Y",
  "bestValueIsPinned": true
}
```
Admin yahi plans `/api/admin/franchise-plans` se banata/edits karta hai
(`POST`, `PATCH /:id`, `PATCH /:id/best-value`, `PATCH /:id/status`, `DELETE /:id` = soft delete).

Franchise apply karte waqt sirf **plan ka code** (`planCode`) bhejna hota hai —
fee/GST server khud plan se uthata hai.

---

## Stage 1 — Naya franchise apply karta hai (2 step, OTP ke saath)

### Step 1a — details + plan + business data

```http
POST /api/franchise/entry           (public, rate limit 500 / 10 min per IP)
```
```json
{
  "name": "Flow Check Franchise",
  "email": "flowcheck.123456@example.com",
  "mobile": "9241308123",
  "dob": "1990-04-11",
  "panNumber": "ABCDE1234F",
  "continent": "Asia",
  "country": "India",
  "pincode": "110001",
  "state": "Delhi",
  "city": "New Delhi",
  "planCode": "3Y",
  "businessName": "Flow Check Enterprises",
  "businessType": "Private Limited",
  "gstNumber": "27ABCDE1234F1Z5",
  "address": "1 Test Street",
  "yearsInBusiness": "4"
}
```
Response: `200` `{ success, message: "OTP sent to 92******23", mobileMasked, nextStep: "verify-otp" }`

- Yahan **koi account nahi banta** — poora form `otps` collection me `pendingDetails`
  ke roop me pending rehta hai (`entry.service.startEntry`). Adhoora form chhodhne par kuch nahi bachta.
- `planCode` ki jagah purana free-text `package` bhi chalta hai (backward compat), par kam
  se kam ek dena zaroori hai.
- `planCode` galat/deactivated ho to **400** (`resolveActivePlan` — sirf active plan).

### Step 1b — OTP verify (yahin account banta hai)

```http
POST /api/franchise/entry/verify    { "mobile": "9241308123", "otp": "123456" }
```
```json
{
  "success": true, "message": "Mobile verified successfully",
  "token": "<JWT role=Franchise>",
  "idType": "franchise",
  "nextStep": "franchise-pending",
  "franchiseStatus": "Pending",
  "franchiseId": null,
  "package": "3-Year-Plan",
  "plan": { "code": "3Y", "name": "3-Year-Plan", "fee": 249000, "totalWithGst": 293820 },
  "user": { "_id": "6ad0…", "name": "Flow Check Franchise", "mobile": "9241308123",
            "email": "flowcheck.123456@example.com", "dob": "1990-04-11",
            "panNumber": "ABCDE1234F", "isVerified": true,
            "franchiseStatus": "Pending", "franchiseId": null }
}
```

Yahan hi:

- account `franchises` collection me banta hai (customer ke `users` me nahi — alag collection, isliye
  franchise kabhi customer list me nahi aa sakti),
- entry ka plan **snapshot** ke roop me utarta hai (fee/GST us waqt ki — baad me admin fee badle
  to record nahi badalta), `package` = plan ka naam,
- `franchiseStatus` seedha **Pending** ho jaata hai + `franchiseAppliedAt` — **alag `POST /apply` step nahi hai**,
- **FRN code aur password abhi nahi milte** (dono admin approve karne par bante hain).
- Password response me kabhi nahi aata; `token` sirf franchise ka hota hai.

---

## Stage 2 — Pending franchise kya kar sakti hai / kya nahi

| Endpoint | Pending | Approved |
|----------|---------|----------|
| `GET /api/franchise/status` | ✅ `franchiseStatus: "Pending"`, `canLogin: false` | ✅ `canLogin: true` |
| `GET /api/franchise/profile` | ✅ | ✅ |
| `GET /api/franchise/loans` | ❌ **403** "Your franchise is not approved yet…" | ✅ |
| `POST /api/franchise/customer/*` (register/verify-otp/applyloan/list) | ❌ **403** | ✅ |
| `POST /api/franchise/login` | ❌ 401 "Your franchise is not approved yet." | ✅ |

Status screen (`GET /api/franchise/status`) reject hone par hi admin ka note dikhata hai:
`rejectionReason`. **FRN/password yahan kabhi nahi aate** — wo admin se milte hain.

Guard lagta hai `src/middleware/franchise.middleware.js` se
(`requireFranchise` → `loadFranchise` → `requireApprovedFranchise`).

---

## Stage 3 — Admin review karta hai

```http
GET  /api/admin/franchises?status=Pending&search=9876…      (admin token)
```
Response ka key **`franchises`** hai (data nahi):
```json
{ "success": true, "franchises": [ { "_id": "6ad0…", "name": "…", "mobile": "…",
  "franchiseStatus": "Pending", "franchiseId": null,
  "plan": { "code": "3Y", "fee": 249000, "totalWithGst": 293820, "snapshotAt": "…" },
  "businessDetails": { … } } ],
  "total": 1, "page": 1, "limit": 0, "totalPages": 1 }
```
`search` naam/email/mobile/FRN/city/state par match karta hai; `status` = None|Pending|Approved|Rejected.
Response me **password hash kabhi nahi** aata.

Har franchise ka poora screen:
```http
GET /api/admin/franchises/:id
```
```json
{ "success": true,
  "credentials": null,          // Pending par null; approve hone par { loginId, password, passwordIsPan: true }
  "loanCount": 0,
  "franchise": { … } }
```

### Approve

```http
PATCH /api/admin/franchises/:id/approve
```
```json
{ "success": true, "message": "Franchise approved. Login ID: FRN000010",
  "credentials": { "loginId": "FRN000010", "password": "ABCDE1234F", "passwordIsPan": true,
                   "note": "Share these with the franchise partner. …" },
  "franchise": { "franchiseId": "FRN000010", "franchiseStatus": "Approved",
                 "franchiseApprovedAt": "2026-10-15T07:41:52.021Z", "password": "…absent…" } }
```
Approve karne par hi:
1. `FRN000010` mint hota hai (`utils/sequence.js` → `nextFranchiseCode`),
2. **password = franchise ka PAN number**, bcrypt hash ke roop me (`select: false`, koi response ise echo nahi karta),
3. `franchiseStatus = Approved` + `franchiseApprovedAt`.

Errors: already approved → **409**, PAN missing → **400**, id galat → **404**.

### Reject / password reset

```http
PATCH /api/admin/franchises/:id/reject          { "note": "Documents missing" }
PATCH /api/admin/franchises/:id/reset-password
```
`reject` ke waqt ka `note` `businessDetails.adminNote` me jaata hai, aur wahi note
franchise ko uske status screen par dikhta hai. `reset-password` sirf approved franchise ka
hash dobara PAN se banata hai (purane records jinka password mobile tha).

---

## Stage 4 — Approved franchise login karti hai

```http
POST /api/franchise/login           { "franchiseId": "FRN000010", "password": "ABCDE1234F" }
```
`200` → `{ success, message: "Login successful", token, franchise: { … password absent … } }`

- Sirf `franchiseStatus: "Approved"` par chalta hai.
- Galat password / galat FRN → **401 "Invalid franchise ID or password"** (dono me same message).
- Rate limit: **10 login / 15 min per IP** (`adminLoginLimiter`) → zyada try par `429`.
- `lastLogin` update hota hai.

---

## Stage 5 — Franchise apna customer register karta hai (OTP = customer ki haan)

### 5a — Register

```http
POST /api/franchise/customer/register       (franchise token, Approved hona zaroori)
```
```json
{ "fullName": "Flow Finish Customer", "mobile": "8366421456", "panNumber": "PQRSX6789K",
  "dob": "1991-03-05", "email": "flowcust.finish@example.com",
  "state": "Maharashtra", "city": "Pune", "pincode": "411001" }
```
`201` → `{ success, message: "Customer saved. An OTP has been sent to the customer's mobile (8366421456) for verification.",
` `nextStep: "verify-otp", data: { _id: "<franchiseCustomerId>", … isVerified: false } }`

- Record `franchisecustomers` collection me jaata hai, `franchise` + `franchiseCode` (FRN) stamp ke saath.
  **Yahi `franchise` field ownership hai** — doosri franchise ka customer 404 deta hai.
- Ek franchise ek hi mobile ko do baar register nahi kar sakti → **409**
  ("already registered by your franchise") — index `{ franchise, mobile }` unique.
- Apne hi franchise mobile se register → **400** ("This mobile belongs to a franchise account").
- `fullName`, `mobile` (10 digit), `panNumber`, `dob` (**18–65 years**), `email` **zaroori**; state/city/pincode optional.
- OTP customer ke phone par jaata hai (dev me `SMS_PROVIDER=console` → server log, `STATIC_OTP=123456`).

### 5b — Customer ka OTP verify (yahin CUST id banti hai)

```http
POST /api/franchise/customer/verify-otp     { "mobile": "8366421456", "otp": "123456" }
```
```json
{ "success": true, "message": "Customer mobile verified successfully.",
  "customer": { "_id": "6ad0…", "fullName": "Flow Finish Customer", "mobile": "8366421456",
                "panNumber": "PQRSX6789K", "email": "flowcust.finish@example.com",
                "isVerified": true, "verifiedAt": "2026-10-15T07:45:35.484Z" },
  "customerId": "CUST000045",
  "nextStep": "loan-apply" }
```

- Customer ka `users` account + `CUST000045` **isi step par** banta hai (`isVerified: true`), par
  **customer ka token franchise ko nahi diya jaata** — franchise apne token se hi kaam karta hai.
- Already verified ho chuka customer dobara verify karne par **409**.
- OTP sirf isi franchise ke isi customer ka chalta hai (`expectedFranchiseCustomerId`).

---

## Stage 5c — Customer ka loan form (OTP verify ke baad)

```http
POST /api/franchise/customer/personal/applyloan
```
Form validate hokar 24 ghante ke liye draft hota hai. Response ka `draft.draftId`
score request ke liye sambhal kar rakhein.

## Stage 6 — Customer ka credit score aur application submit

```http
POST /api/franchise/customer/{{franchiseCustomerId}}/credit-score
```
```json
{ "draftId": "<UUID_FROM_APPLY_RESPONSE>", "creditScore": 720 }
```
Score `300`–`900`; `>= 600` par credit eligibility set hoti hai aur isi call me
pending draft actual loan application ban jaata hai. Score `< 600` par draft retained
rahega; eligible response `nextStep: "complete"` aur application deta hai.

`200` →
```json
{ "success": true, "eligible": true, "product": "personal", "nextStep": "complete",
  "application": { "applicationNo": "LOAN000049", "status": "Submitted", ... } }
```

Zaroori baatein:

- **Product URL se aata hai** — `/:product/applyloan`. Segment flexible hai:
  `personal`, `personal-loan`, `personalloan`, `gold-loan`, `credit-card`, … sab apne
  config key par resolve hote hain (`productFromParam` → `PRODUCT_ALIASES`).
- `franchiseCustomerId` **mandatory** (400: "franchiseCustomerId is required…").
- **Customer mobile OTP verify hona zaroori** — warna **403** ("This customer's mobile is not verified yet…").
- **Credit score apply form ke baad submit hota hai** — score `>= 600` par application
  create hoti hai; score `< 600` par draft retained rehta hai.
- Doosri franchise ka customer id → **404** (scoping `franchise` par).
- Product ke normal apply rules hi chalte hain (`loanValidator.buildApplyValidator`), isliye
  **`fullName` aur `mobile` body me hamesha bhejna padta hai** (personal details ke rules me ye do
  hamesha required hain). Baaki personal fields optional hain — service unhe franchise customer ke
  profile se override/fill karti hai (naam, mobile, PAN, DOB, email + khali state/city/pincode).
- Applicant details dobara nahi bharne padte: form ka `fullName`/`mobile` bhi profile se hi match hote hain.
- Loan par teen stamps lagte hain: `franchise` (ObjectId), `franchiseCode` (FRN), `franchiseCustomer`,
  aur `applicationNo` (`LOAN000049` — counter `utils/sequence.js` se).
- Customer ka `users` account mobile se link ya naya banta hai (email zaroori; duplicate email → **400**),
  taaki customer apne dashboard par wahi application dekh sake.

---

## Stage 7 — Tracking (franchise ke side se)

```http
GET /api/franchise/loans                      → apni poori book, product-wise grouped
GET /api/franchise/customer                   → apne customers (search, page, limit, total, totalPages)
GET /api/franchise/customer/:id               → ek customer
PATCH /api/franchise/customer/:id             → details update
GET /api/franchise/customer/:id/loans         → us customer ke saare loans + status/stage/timeline
GET /api/franchise/customer/:id/loans/:applicationNo   → ek loan (LOAN000049)
```
```json
{ "success": true, "franchiseId": "FRN000010",
  "customer": { "_id": "6ad0…", "fullName": "Flow Finish Customer", "mobile": "8366421456" },
  "total": 1, "byStatus": { "Submitted": 1, "Pending": 0, "Approved": 0, "Rejected": 0 },
  "data": [ { "product": "personal", "count": 1, "applications": [
      { "applicationNo": "LOAN000049", "status": "Submitted", "stageKey": "submitted", … } ] } ] }
```
Wahi status/stage/timeline jo customer apne dashboard par dekhta hai (`customer.service.buildStatusView`).

---

## Stage 8 — Admin decide karta hai, franchise ko turant dikhta hai

```http
GET   /api/admin/personal-loans                 → key `loans` (naya pehle)
GET   /api/admin/personal-loans/:id             → key `loan`
PATCH /api/admin/personal-loans/:id/status      { "status": "Approved", "note": "…" }
GET   /api/admin/franchises/:id/loans           → us FRN se aayi applications (product-wise)
GET   /api/admin/franchise-customers            → franchise customers ka poora network view
```
- Resource naam plurals me: `personal-loans`, `business-loans`, `home-loans`,
  `loan-against-properties`, `credit-cards`, … (`adminStatus.service.RESOURCE_ROUTES`).
- Row me `franchiseCode: "FRN000010"` + `franchise` + `franchiseCustomer` set hote hain — admin ko
  pata chalta hai ki kaunsi franchise laayi.
- Status machine: `Submitted → Pending → Approved|Rejected`; `Approved`/`Rejected` ke baad change
  nahi hota (**409**), same status dobara → **409**.
- Patch ke turant baad franchise ke `GET /api/franchise/customer/:id/loans/:applicationNo` par
  `status: "Approved"` dikhta hai (live verify kiya gaya).

---

## Ek line me flow

```
Admin plans
   ↓
POST /api/franchise/entry  (details + planCode)  →  OTP
   ↓
POST /api/franchise/entry/verify  →  account + token + status Pending + plan snapshot   (kuch aur 403)
   ↓
Admin: GET /api/admin/franchises?status=Pending  →  PATCH /:id/approve
       (FRN000010 + password = PAN number bcrypt hash)
   ↓
POST /api/franchise/login  { franchiseId: FRN000010, password: <PAN> }  →  token
   ↓
POST /api/franchise/customer/register  →  customer + OTP
   ↓
POST /api/franchise/customer/verify-otp  →  CUST000045 (customer ka users account)
   ↓
POST /api/franchise/customer/:product/applyloan  { franchiseCustomerId, … }  →  draftId
   ↓
POST /api/franchise/customer/:id/credit-score  { draftId, creditScore: 720 }
       →  LOAN000049 when score >= 600  (franchise + FRN + franchiseCustomer stamp)
   ↓
Franchise tracking: /api/franchise/customer/:id/loans · /api/franchise/loans
Admin decision:     PATCH /api/admin/personal-loans/:id/status   →  franchise ko turant dikhta hai
```

---

## Chhote gotchas (code se + live run se)

1. **Response wrappers module-wise alag hain**: franchise customer/list → `data`; admin franchise list →
   `franchises`; admin loan list → `loans`; franchise customer loans → `data` + `customer`.
2. **`fullName` + `mobile` apply body me hamesha chahiye**, chahe details profile se hi aate hon.
3. **Rate limits**: OTP request 500/10min, OTP verify 10/10min, login (admin + franchise) 10/15min — IP par.
   Testing me 429 aa sakta hai; server restart se in-memory counters clear ho jaate hain.
4. **`franchiseStatus` verify response me top level** hota hai (`verify.body.franchiseStatus`), `franchise` object ke andar nahi;
   account id `body.user._id` me aata hai.
5. Password kahin bhi response me nahi aata — sirf approve/reset response ka `credentials` block deta hai
   (`loginId` + `password` = PAN + `passwordIsPan: true`).
6. Unapproved franchise ke paas `franchiseId` `null` rehta hai; FRN sirf approve par mint hota hai
   (unique + sparse index).
