# Indexia Finance — API Reference (User + Admin)

Base URL (dev): `http://localhost:5000`
Auth header: `Authorization: Bearer <TOKEN>`
- Customer/Franchise token: `/api/auth/verify-otp` (ya franchise `/api/franchise/login`)
- Admin token: `/api/admin/auth/login`

---

# PART 1 — USER SIDE

## 1.1 Loan Entry — register / login hata diye gaye

Customer ka account sirf **mobile OTP verify** hone par banta hai, aur usi waqt
**CUST id** (`CUST000001`) aur **token** milta hai. Poora detail: `docs/LOAN-ENTRY-API.md`.

### `POST /api/auth/:product`  (public — per-loan entry, step 1)
Product URL me: `/api/auth/personal-loan`, `/gold-loan`, `/credit-card`, `/loan-against-property` …
```json
REQ  { "name": "Rahul", "email": "rahul@example.com", "mobile": "9876543210",
       "dob": "1995-05-15", "panNumber": "ABCDE1234F",
       "continent": "Asia", "country": "India" }
RES  { "success": true, "message": "OTP sent to 98******10",
       "product": "personal", "loanType": "Personal Loan", "nextStep": "verify-otp" }
```
Customer auth entry mein `city` aur `pincode` nahi bhejne hain; ye fields customer
auth request se ignore hoti hain. Franchise entry alag endpoint aur flow hai.
Mobile 10 digits ka ho aur `0` se start na ho. Applicant ki age 18 se 65 years
ke beech honi chahiye; is range se bahar DOB par validation error milega.
Kuch save nahi hota — details OTP document me pending rehti hain, isliye adhoora form
chhodhne par koi half-filled customer record nahi banta. Agar mobile ya email kisi
customer account se pehle se linked hai to `409` aayega aur customer ko registered
mobile se login karne ko kaha jayega; existing customer ke liye login flow use karein.

### `POST /api/auth/verify-otp`  (public — step 2)
```json
REQ  { "mobile": "9876543210", "otp": "123456" }
RES  { "success": true, "message": "Mobile verified successfully", "token": "<JWT>",
       "idType": "customer", "customerId": "CUST000001", "product": "personal",
       "loanType": "Personal Loan", "nextStep": "loan-apply",
       "user": { "_id": "…", "customerId": "CUST000001", "name": "Rahul",
                 "mobile": "9876543210", "email": "…", "dob": "1995-05-15",
                 "panNumber": "ABCDE1234F", "role": "Customer", "isVerified": true } }
```
Yahin account + CUST id + token banta hai. Us token se loan form: `POST /api/customer/loan-apply`.
OTP ki koi expiry nahi hai — wahi OTP jitni baar chaho dobara verify kiya ja sakta
hai; repeat
request wahi account response/token degi aur account/franchise side-effects dobara
nahi chalayegi. Naya OTP request purane OTP ko replace kar deta hai.

### `GET /api/auth/profile` · `/customer/profile` · `/franchise/profile` → `{ "success": true, "user": { ... } }`

Franchise ka darwaza alag hai — entry: `POST /api/franchise/entry` + `/entry/verify`, login:
`POST /api/franchise/login` (FRN + password). Customer ka koi login nahi hai; wo apna status
CUST id + PAN + OTP se dekhta hai — `POST /api/customer/status/request-otp` + `POST /api/customer/status`
(dekho §1.2 ka status door; token ki zaroorat nahi).

## 1.2 Customer

### `GET /api/customer/loan-apply?product=personal&employmentType=Salaried` (customer token)
Returns only `product`, application status, and the saved application in `data`
(or `null` if not applied). The application is returned once as flat fields:
empty values and the duplicate `sections` snapshot are omitted.
OTP verify ke baad customer seedha loan form bhare. Is GET se form config aur
agar pehle save hua ho to draft milta hai. Form submit pehle draft save karta hai;
score API us draft ko eligible hone par final submit karti hai.
`POST /api/customer/apply-register` **hata diya gaya** (dob/PAN ab entry form me hain).

### `POST /api/customer/loan-apply` (unified — `product` in body)
```json
REQ  { "product": "personal",
       "loanAmount": 500000, "loanTenure": 3, "employmentType": "Salaried",
       "companyName": "ABC Corp", "companyType": "Private Limited",
       "monthlySalary": 50000, "salaryReceivedAs": "Bank Transfer", "salaryBankName": "HDFC",
       "fullName": "Rahul", "mobile": "9876543210", "email": "…",
       "dob": "1995-05-15", "panNumber": "ABCDE1234F" }
RES 202 { "success": true, "product": "personal", "resumed": false,
       "nextStep": "credit-score",
       "draft": { "draftId": "…", "expiresAt": "…" } }

Form **24 ghante** ke liye draft me hold hota hai (per product), taaki customer ko
details dobara bharani na padein; final loan application abhi create nahi hoti.
Required loan amount kam se kam ₹1,00,000 hona chahiye; kuch products par isse
zyada product-specific minimum lagu ho sakta hai.
Yaani score bhi usi 24 ghante ke andar submit karna hai — response ka `expiresAt`
UI par countdown ke liye dikhana chahiye.
Draft `{ user, product }` par unique hai — doosre product ka form isko replace
nahi karta. `GET /api/customer/loan-apply?product=…` ka `pendingDraft` (usme
`data` = bhara hua form) resume ke liye use karein. Usi product ka purana draft
update ho raha ho to response me `resumed: true` aata hai.
Draft response ka `draftId` lekar score API hit karein:
`POST /api/customer/credit-score` `{ "draftId": "…", "creditScore": 720 }`.
Customer agar loan/product change karna chahe to apna pending draft cancel kar sakta hai:
`GET /api/customer/loan-apply/draft` se active draft dekhein; response ka
`draft.draftId` lekar `DELETE /api/customer/loan-apply/draft` body
`{ "draftId": "…" }` call karein. Iske baad naya product form submit karein.
`draft.product` aur `draft.data` se form resume bhi kiya ja sakta hai. Dono
methods same `/draft` URL use karte hain. Cancellation sirf authenticated
customer ka active draft delete karti hai; completed/expired/missing draft par
`404` aata hai. No active draft par `hasPendingDraft: false` aata hai. Draft
24 ghante baad expire hota hai.
Score integer `300–900` hona chahiye. `600+` par final loan application save hoti
hai aur 24-hour eligibility window shuru hoti hai. `300–599` par API `200` ke
saath `eligible: false` deti hai; draft retained rehta hai (`draftRetained: true`)
aur customer dobara score submit kar sakta hai. Payment is flow ka hissa nahi hai.
Same customer same product par application submit karne ke baad 3 din ke andar
dobara apply nahi kar sakta; 3 din baad usi product ke liye nayi application
submit ki ja sakti hai.

Response me sirf wo field aati hai jo applicant ne bhari ho: `_id` / `user` / `__v`,
khaali values (`""`, `[]`, `{ "banks": [] }`) aur `franchise` / `franchiseCode` /
`franchiseCustomer` (direct application me null hote hain) nahi bheje jaate. Jab loan
franchise ne file kiya ho to ye teen fields values ke saath response me rehti hain.
```
Per-product routes bhi same: `POST /api/personal-loan/apply`, `/api/home-loan/apply`, … (franchise token par 403).
**Product scope:** token jis product ki entry (`POST /api/auth/<product>`) se bana tha,
apply sirf usi product ka chalta hai — doosre product par `403 { "success": false,
"entryProduct", "requestedProduct", "message" }`. Doosre product ke liye uski apni
entry + OTP + naya token chahiye.

### `GET /api/customer/loans?status=` — grouped
```json
RES { "success": true, "userId": "…", "total": 2,
      "data": [ { "product": "personal", "count": 1, "applications": [ … ] },
                { "product": "business", "count": 1, "applications": [ … ] } ] }
```

### `GET /api/customer/loans/:applicationNo` — status/stage/timeline
```json
RES { "success": true, "application": {
      "applicationNo": "LOAN000001", "product": "personal", "loanType": "Personal Loan",
      "loanAmount": 500000, "status": "Approved", "stage": "Approved", "stageKey": "approved",
      "step": 3, "stages": ["Application Submitted", "Under Review", "Approved"],
      "submittedAt": "…", "decisionAt": "…", "adminNote": "Verified",
      "timeline": [ { "step": "Application Submitted", "at": "…" }, { "step": "Approved", "at": "…" } ],
      "details": { ...poori application... } } }
```

### `GET /api/customer/loan-status?panNumber=ABCDE1234F`
```json
RES { "success": true, "panNumber": "ABCDE1234F", "total": 1,
      "applications": [ { "applicationNo": "LOAN000001", "status": "Submitted",
                          "stage": "Application Submitted", "stageKey": "submitted" } ] }
```

### `GET /api/customer/summary`
```json
RES { "success": true, "userId": "…", "total": 1,
      "byStatus": { "Submitted": 0, "Pending": 0, "Approved": 1, "Rejected": 0 },
      "byProduct": [ { "product": "personal", "count": 1 } ],
      "recent": [ { "applicationNo": "LOAN000001", "status": "Approved", "stage": "Approved" } ] }
```

### `POST /api/customer/status/request-otp` · `POST /api/customer/status` — status door (NO token)
```json
REQ  { "customerId": "CUST000001", "panNumber": "ABCDE1234F", "mobile": "9876543210" }
RES 200 { "success": true, "message": "OTP sent to 98******10",
          "mobileMasked": "98******10", "nextStep": "status" }

REQ  { "mobile": "9876543210", "otp": "123456" }
RES 200 { "success": true,
          "customer": { "customerId": "CUST000001", "name": "Rahul Sharma",
                        "mobileMasked": "98******10", "panNumber": "ABCDE1234F" },
          "total": 1,
          "byStatus": { "Submitted": 0, "Pending": 1, "Approved": 0, "Rejected": 0 },
          "stages": [ "Application Submitted", "Under Review", "Approved" ],
          "applications": [ { "applicationNo": "LOAN000001", "product": "personal",
                              "loanType": "Personal Loan", "loanAmount": 300000,
                              "status": "Pending", "stage": "Under Review", "step": 2,
                              "adminNote": "Documents received",
                              "timeline": [ { "step": "Application Submitted", "at": "…" },
                                            { "step": "Under Review", "at": "…" } ] } ] }
```
OTP request par customer identity **CUST id + PAN** se check hoti hai, aur bheja mobile
registered mobile se match hona chahiye. Status response ke liye sirf usi mobile par
gaya **OTP + mobile** chahiye. Har application ka stage/timeline/adminNote wahi hota hai
jo admin dashboard par dikhta hai. Errors: `400` format/OTP, `404` customer identity ya
mobile match na hone par.

---

## 1.3 Franchise

### `POST /api/franchise/entry` → `POST /api/franchise/entry/verify`
Ek hi form: basic details + **plan** + business data, phir OTP.
```json
REQ  { "name": "Amit Verma", "email": "amit@example.com", "mobile": "9876543222",
       "dob": "1990-01-20", "panNumber": "ABCDE1234F",
       "continent": "Asia", "country": "India",
       "pincode": "110001", "state": "Delhi", "city": "New Delhi",
       "planCode": "3Y", "businessName": "Amit Enterprises",
       "businessType": "Proprietorship", "gstNumber": "", "address": "", "yearsInBusiness": "3" }
RES  { "success": true, "message": "OTP sent to 98******22", "nextStep": "verify-otp" }

POST /api/franchise/entry/verify   { "mobile": "9876543222", "otp": "123456" }
RES  { "success": true, "token": "<JWT>", "idType": "franchise",
       "franchiseStatus": "Pending", "package": "3 Years",
       "plan": { "code": "3Y", "name": "3 Years", "fee": 210000, "totalWithGst": 247800 },
       "nextStep": "franchise-pending", "user": { … } }
```
Plan ka snapshot + Pending verify par hi lag jaate hain — **alag `/api/franchise/apply`
ab nahi hai**. Password kabhi response me nahi aata.

### `GET /api/franchise/profile` / `GET /api/franchise/status`
```json
// status: login ID/password kabhi nahi; reject hone par admin ka reason
RES { "success": true, "franchiseStatus": "Rejected", "canLogin": false,
      "rejectionReason": "PAN and business name do not match",
      "message": "Your franchise application was rejected. Reason: …" }
```

### `POST /api/franchise/login`
```json
REQ  { "franchiseId": "FRN000001", "password": "ABCDE1234F" }   // password = PAN (apply me diya gaya)
RES  { "success": true, "token": "<JWT franchiseId=FRN000001>", "franchise": { … } }
```

### `POST /api/franchise/customer/register` (Approved only) → `/verify-otp`
Customer ki details save hoti hain aur **uske mobile par OTP** chala jaata hai; OTP
verify hone par hi uske liye `users` account + CUST id banti hai (`email` ab zaroori
hai). Uske baad `/:product/applyloan` — verify se pehle wo `403` deta hai.
```json
REQ  { "fullName": "Rahul Sharma", "mobile": "9876543210", "panNumber": "ABCDE1234F",
       "dob": "1995-05-15", "email": "rahul@example.com", "city": "Pune" }
RES 201 { "success": true,
       "message": "Customer saved. You can now apply for a loan for this customer.",
       "data": { "_id": "<FRANCHISE_CUSTOMER_ID>", "fullName": "Rahul Sharma" } }
```
Wahi franchise same mobile dobara register kare -> `409`. Kisi doosri franchise
ka customer `404` hi deta hai.

### Franchise customer flow (Approved only)
Pehle register aur OTP verify karein; uske baad `POST /api/franchise/customer/:product/applyloan`
loan form ka temporary draft save karta hai. `draft.draftId` lekar phir
`POST /api/franchise/customer/:id/credit-score` par score bhejein; score `>= 600`
hone par actual loan application submit hoti hai.
```json
REQ  { "franchiseCustomerId": "<FRANCHISE_CUSTOMER_ID>",
       "loanAmount": 300000, "loanTenure": 2, "employmentType": "Salaried",
       "companyName": "XYZ Ltd", "companyType": "Private Limited",
       "monthlySalary": 40000, "salaryReceivedAs": "Bank Transfer", "salaryBankName": "ICICI" }
RES 202 { "success": true, "product": "personal", "nextStep": "credit-score",
       "draft": { "draftId": "<UUID>", "expiresAt": "…" } }
```
Then send `{ "draftId": "<UUID>", "creditScore": 720 }` to
`POST /api/franchise/customer/<FRANCHISE_CUSTOMER_ID>/credit-score`.
```
POST /api/franchise/customer/personal/applyloan
POST /api/franchise/customer/gold-loan/applyloan
POST /api/franchise/customer/loan-against-property/applyloan
POST /api/franchise/customer/credit-card/applyloan
```
Accepted forms: config key (`personal`, `goldLoan`, `lap`), key + `loan`
(`personalloan`), kebab-case (`personal-loan`) aur product ka human name
(`loan-against-property`, `od-cc-limit`). Unknown product -> `400`.
Applicant ke personal details (fullName/mobile/PAN/DOB/email) franchise customer
ke profile se aate hain — form inhe dobara nahi bhejta.
Pending/Rejected par -> `403`.

### `GET /api/franchise/customer` / `/customer/:id` / `/customer/:id/loans` (Approved only)
Franchise apne customers, ek customer ki detail, aur us customer ke loans ka
status/stage/timeline dekh sakti hai (`?search=&page=&limit=` bhi chalta hai).

### `GET /api/franchise/loans`
```json
RES { "success": true, "franchiseId": "FRN000001", "total": 1,
      "data": [ { "product": "personal", "count": 1, "applications": [ … ] } ] }
```

---

## 1.4 Public location masters (forms ke liye, no auth)
`GET /api/masters/location/continents` · `/countries?continentId=` · `/states?countryId=` · `/cities?stateId=` · `/pincode/:pin` · `POST /api/masters/location/pincode/validate`

---

# PART 2 — ADMIN SIDE

## 2.1 Auth

### `POST /api/admin/auth/login`
```json
REQ  { "email": "admin@indexiafinance.com", "password": "Admin@123" }
RES  { "success": true, "message": "Login successful", "token": "<ADMIN_JWT>",
       "admin": { "_id": "…", "name": "Super Admin", "role": "SuperAdmin" } }
```
`POST /forgot-password` `{email}` · `POST /reset-password` `{email,otp,newPassword}` ·
`GET /profile` · `PUT /profile` `{name,email}` · `PUT /change-password` `{currentPassword,newPassword}`

## 2.2 Dashboard
### `GET /api/admin/dashboard/stats`
```json
RES { "success": true, "stats": {
      "totalCustomers": 17, "totalFranchises": 3,
      "totalApplications": 12, "submitted": 4, "pending": 3, "approved": 3, "rejected": 2,
      "requestedAmount": 25000000, "approvedAmount": 8000000, "approvalRate": 60,
      "products": [ { "resource": "personal-loans", "label": "Personal loan", "total": 5, … } ],
      "recent": [ { "_id": "…", "product": "Personal loan", "applicantName": "Rahul",
                    "status": "Submitted", "loanAmount": 500000, "createdAt": "…" } ] } }
```

## 2.3 Loan applications (18 resources)
`{resource}` = `personal-loans`, `business-loans`, `home-loans`, `loan-against-properties`,
`working-capitals`, `od-cc-limits`, `commercial-purchases`, `lease-rental-discountings`,
`loan-against-shares`, `npa-loans`, `gold-loans`, `fdi-loans`, `film-fundings`,
`balance-transfers`, `project-loans`, `vehicle-loans`, `education-loans`, `credit-cards`.

| Method | URL | Body | Response |
|---|---|---|---|
| GET | `/api/admin/{resource}` | — | `{ success, loans: [...] }` |
| GET | `/api/admin/{resource}/:id` | — | `{ success, loan: {...} }` |
| PATCH | `/api/admin/{resource}/:id/status` | `{ "status": "Approved", "note": "ok" }` | `{ success, message, loan }` |
| DELETE | `/api/admin/{resource}/:id` | — | `{ success, message, deletedId }` |

Status rules: `Pending/Approved/Rejected`; `Submitted→Any`, `Pending→Approved|Rejected`; galat transition → `409`.

## 2.4 Customers
| Method | URL | Body | Response |
|---|---|---|---|
| GET | `/api/admin/customers?search=&page=&limit=&isActive=` | — | `{ success, customers: [...] }` |
| GET | `/api/admin/customers/:id` | — | `{ success, customer }` |
| GET | `/api/admin/customers/:id/applications` | — | `{ success, customer, total, data: [{product,count,applications}] }` |
| PATCH | `/api/admin/customers/:id/status` | `{ "isActive": false }` | `{ success, message, customer }` |
| DELETE | `/api/admin/customers/:id` | — | `{ success, message }` (open applications par 409) |

## 2.5 Franchises
| Method | URL | Body | Response |
|---|---|---|---|
| GET | `/api/admin/franchises?status=&search=&page=&limit=` | — | `{ success, franchises: [...] }` |
| GET | `/api/admin/franchises/:id` | — | `{ success, credentials, loanCount, franchise }` |
| PATCH | `/api/admin/franchises/:id/approve` | `{}` | `{ success, message: "…Login ID: FRN000001", credentials, franchise }` |
| PATCH | `/api/admin/franchises/:id/reject` | `{ "note": "…" }` | `{ success, message, franchise }` |
| PATCH | `/api/admin/franchises/:id/reset-password` | — | `{ success, message: "…Login ID: FRN000001", credentials, franchise }` |
| GET | `/api/admin/franchises/:id/loans` | — | `{ success, franchise, total, data: [{product,count,applications}] }` |

Approve: `FRN…` mint + **PAN number** ka bcrypt hash password (hash response me nahi aata).

### Franchise login credentials (admin ko dikhne wale)
Approve karne par response me ek alag `credentials` block aata hai — yahi admin franchise partner ko deta hai:

```json
{
  "success": true,
  "message": "Franchise approved. Login ID: FRN000001",
  "credentials": {
    "loginId": "FRN000001",
    "password": "ABCDE1234F",
    "passwordIsPan": true,
    "note": "Share these with the franchise partner. The password is the PAN number submitted with the application."
  },
  "franchise": { "_id": "…", "franchiseId": "FRN000001", "franchiseStatus": "Approved", "panNumber": "ABCDE1234F" }
}
```

- `credentials` **null** hota hai jab tak approve na ho (Pending/Rejected me `franchiseId` hi nahi hota).
- `GET /api/admin/franchises/:id` bhi wahi `credentials` dobara deta hai, to admin baad me login ID/password re-share kar sakta hai.
- List (`GET /api/admin/franchises?status=Approved`) me har row ke andar hi `franchiseId` (login ID) aur `panNumber` (password) mil jaate hain.
- Password bcrypt hash (`$2…`) kabhi kisi response me expose nahi hota.
- Purane franchise (jinka password mobile number tha) ke liye `PATCH /api/admin/franchises/:id/reset-password` chalayein — password dobara PAN se set ho jaata hai, FRN wahi rehta hai.
- Admin ek call me jaan sakta hai kitne loans aaye: `GET /api/admin/franchises/:id` ka `loanCount`, ya `GET /api/admin/franchises/:id/loans` ka `total`.

## 2.6 Location + Masters
- **Location:** `GET/POST/PATCH/DELETE /api/admin/masters/location/{continents|countries|states|cities|pincodes}`
- **Generic masters:** `GET/POST /api/admin/masters`, `GET/PUT/DELETE /api/admin/masters/:id`, `PUT /api/admin/masters/:id/values`
- **Banks:** `GET/POST/PUT /api/admin/masters/banks`, `DELETE /api/admin/masters/banks/:name`, `GET /api/admin/masters/banksdetails`

---

# PART 3 — Status lifecycle

```
Submitted ──► Pending ──► Approved
    │            └──────► Rejected
    └────────────────────► Approved / Rejected
```
Customer-facing stage: `Submitted→Application Submitted`, `Pending→Under Review`,
`Approved→Approved`, `Rejected→Rejected`.

# PART 4 — Loan document

```json
{ "_id": "…", "applicationNo": "LOAN000002",
  "user": "CUSTOMER_ID",
  "franchise": "FRANCHISE_ID ya null",
  "franchiseCode": "FRN000001 ya null",
  "loanType": "Personal Loan", "loanAmount": 300000, "loanTenure": 2,
  "status": "Submitted", "adminNote": "" }
```
Direct customer → `franchise: null`. Franchise ke through → `franchise` + `franchiseCode`.

---

# PART 5 — Customer loan flow ka config (GET)

Verify-otp ke baad client `GET /api/customer/loan-apply?product=<key>` call karta hai
(dekho `docs/LOAN-ENTRY-API.md` section 3) — us product ke sections/fields aur limits
mil jaate hain. Purana step-1 `POST /api/customer/apply-register` **hata diya gaya**:
dob aur PAN ab entry form (`POST /api/auth/:product`) me aate hain aur OTP verify hone
par account par save ho jaate hain, isliye loan form inhe dobara nahi maangta.
