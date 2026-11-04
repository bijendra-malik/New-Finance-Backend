# Register / Login / Franchise Flow

> ⚠️ **Register / signup / customer-login hata diye gaye hain.**
> Customer ka account ab mobile OTP verify hone par banta hai:
> `POST /api/auth/:product` (per-loan entry) → `POST /api/auth/verify-otp`
> (account + `CUST000001` + token) → `POST /api/customer/loan-apply`.
> Franchise ka entry bhi alag hai: `POST /api/franchise/entry` + `/entry/verify`.
>
> Franchise ka **apply** step bhi ab entry me hi hai: plan + business data
> `POST /api/franchise/entry` me hi aate hain aur verify par status **Pending** ho jaata
> hai — alag `POST /api/franchise/apply` hata diya gaya hai.
>
> Naya flow: **`docs/LOAN-ENTRY-API.md`**. Neeche ke section 2 (common register/login)
> aur section 4 (franchise apply) purane hain; approve / login (section 5, 6) waise hi
> valid hain. Franchise ke customer ka bhi ab OTP verify hota hai
> (`POST /api/franchise/customer/verify-otp`).

Ye document naya **common register + OTP + role-based** process describe karta hai.
Loan product ki existing apply APIs (`/api/personal-loan/apply`, `/api/home-loan/apply`, …)
**same hi rahi hain** — sirf account/register/login process aur franchise channel add hua hai.

---

## 1. One account collection, do roles

`User` collection me hi dono account types rehte hain, `role` se alag:

| role | kaun | dashboard |
|------|------|-----------|
| `Customer` | direct applicant | customer dashboard |
| `Franchise` | channel partner (approval chahiye) | franchise dashboard |
| `User` (legacy) | purane account | customer ki tarah treat hota hai |

JWT me `{ id, mobile, role, franchiseId }` aata hai — isliye koi bhi API client ke
bheje hue naam/mobile par trust nahi karti.

---

## 2. Common Register (Customer + Franchise)

### `POST /api/auth/register`
```json
{
  "role": "Customer",          // ya "Franchise" (optional, default Customer)
  "continent": "Asia",
  "country": "India",
  "name": "Rahul",
  "mobile": "9876543210",
  "email": "rahul@example.com"
}
```
- Account `isVerified:false` ke saath ban jaata hai + OTP SMS (dev: server log / `STATIC_OTP`).
- Agar mobile pehle se unverified hai to wahi account update hota hai.
- Verified account pe dobara register → 400 "Please login instead".

### `POST /api/auth/verify-otp`
```json
{ "mobile": "9876543210", "otp": "123456" }
```
Response me `token`, `user`, aur `nextStep`:
`customer-dashboard` | `franchise-apply` | `franchise-pending` | `franchise-dashboard` | `franchise-rejected`.

### Login (OTP wala, dono roles ke liye)
- `POST /api/auth/login` `{ mobile }` → OTP
- `POST /api/auth/login/:product/verify-otp` `{ mobile, otp }` → JWT; URL ke
  selected product par pichhle 3 din mein application hui ho to `409` wait message
- `GET /api/auth/profile` (Bearer token)

---

## 3. Customer flow

```
/register (role=Customer) → OTP → JWT → Customer Dashboard
        → Loan product select → existing product apply API
```

### Customer loan apply (koi change nahi)
```
POST /api/personal-loan/apply      (Authorization: Bearer <JWT>)
POST /api/business-loan/apply
POST /api/home-loan/apply          … (sabhi 18 products)
GET  /api/<product>/applications
```
Backend `req.user.id` se customer identify karta hai. Har application ko ek
`applicationNo` milta hai (LOAN000001, LOAN000002 …) aur direct application me
`franchise: null` hota hai.

> Note: ek Franchise token in direct endpoints ko 403 deta hai — franchise ko
> `/api/franchise/customer/:product/applyloan` use karna hoga.

---

## 4. Franchise flow

```
/register (role=Franchise) → OTP → JWT → franchiseStatus = "None"
        → POST /api/franchise/apply (state, city, package, PAN, business…) 
        → franchiseStatus = "Pending"
        → Admin approve → franchiseId = FRN000125 + PAN ka hash password
        → POST /api/franchise/login (FRN + password) → JWT
        → POST /api/franchise/customer/register
        → POST /api/franchise/customer/:product/applyloan
```

Register karna = approved hona **nahi**. Approval admin karta hai.

### `POST /api/franchise/apply`  (franchise token)
```json
{
  "panNumber": "ABCDE1234F",
  "state": "Uttar Pradesh",
  "city": "Noida",
  "package": "Premium",
  "businessName": "Amit Enterprises",
  "businessType": "Proprietorship",
  "gstNumber": "",
  "address": "",
  "yearsInBusiness": "3"
}
```
`name/mobile/email/continent/country` registration se hi automatic aate hain.

### `GET /api/franchise/profile` / `GET /api/franchise/status`
Registration data + `franchiseStatus` + `franchiseId`.

### `POST /api/franchise/login`  (public)
```json
{ "franchiseId": "FRN000125", "password": "ABCDE1234F" }
```
Password initially **PAN number** hota hai (application me diya gaya), par DB me sirf bcrypt **hash** store hota hai.
Sirf `franchiseStatus = Approved` hi login kar sakta hai.

### `POST /api/franchise/customer/register`  (Approved franchise only)
Franchise apna customer register karti hai:
```json
{
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "panNumber": "ABCDE1234F",
  "dob": "1995-05-15",
  "email": "rahul@example.com",
  "city": "Pune"
}
```
Response `201` me customer ka `_id` (`franchiseCustomerId`) milta hai.

### `POST /api/franchise/customer/:product/applyloan`  (Approved franchise only)
`product` URL me aata hai; body me us product ka loan payload + `franchiseCustomerId`:
```json
{
  "franchiseCustomerId": "64f...",
  "loanAmount": 500000, "loanTenure": 3,
  "employmentType": "Salaried",
  "companyName": "ABC Corp", "companyType": "Private Limited",
  "monthlySalary": 50000, "salaryReceivedAs": "Bank Transfer", "salaryBankName": "HDFC"
}
```
- `loanTenure` **years** me hota hai.
- Applicant ke personal details (fullName/mobile/PAN/DOB) franchise customer ke
  profile se aate hain — form inhe dobara nahi bhejta.
- Document me: `user = customer account`, `franchise = franchise account`,
  `franchiseCode = FRN000125`, `franchiseCustomer = <customer>`, `applicationNo = LOAN...`.

Product ke accepted forms: `personal`, `personalloan`, `personal-loan`,
`gold-loan`, `loan-against-property`, `credit-card` ... (unknown -> `400`).

### `GET /api/franchise/loans`  (Approved franchise only)
Is FRN se aaye saare loans, product-wise grouped + `total`.

---

## 5. Admin APIs

Admin auth: `POST /api/admin/auth/login` (email + password) → `Bearer` token.

### Franchise applications
| Method | Endpoint | Kaam |
|--------|----------|------|
| GET | `/api/admin/franchises?status=&search=&page=&limit=` | list (status: None/Pending/Approved/Rejected) |
| GET | `/api/admin/franchises/:id` | ek application |
| PATCH | `/api/admin/franchises/:id/approve` | approve + FRN mint + PAN password hash |
| PATCH | `/api/admin/franchises/:id/reset-password` | password dobara PAN se set (purane mobile-hash wale franchise ke liye) |
| PATCH | `/api/admin/franchises/:id/reject` | reject (`{ "note": "..." }`) |
| GET | `/api/admin/franchises/:id/loans` | is FRN ke saare loans (grouped + total) |

`approve` response: `franchise.franchiseId` (e.g. `FRN000125`) — yahi franchise ka login ID hai.

### Loan / customer admin (unchanged + franchise aware)
- `GET /api/admin/<resource>` … `PATCH /api/admin/<resource>/:id/status` — wahi 18 products.
- `GET /api/admin/customers` ab **sirf customers** deta hai (franchise accounts hide).
- `GET /api/admin/customers/:id/applications` — ek customer ke saare loans, product-wise.
- `GET /api/admin/dashboard/stats` — ab `totalCustomers` + `totalFranchises` dono.

---

## 6. Loan document shape (har product)

```json
{
  "_id": "…",
  "applicationNo": "LOAN000125",
  "user": "CUSTOMER_USER_ID",
  "franchise": "FRANCHISE_USER_ID | null",
  "franchiseCode": "FRN000125 | null",
  "loanType": "Personal Loan",
  "loanAmount": 500000,
  "loanTenure": 3,
  "status": "Submitted"
}
```

- Direct customer: `franchise = null`.
- Franchise ke through: `franchise = FRANCHISE_USER_ID`, `franchiseCode = FRN…`.
- Ek user ki multiple loans: sabki apni `_id` + `applicationNo`, `user` same.

---

## 7. Important files

| File | Kaam |
|------|------|
| `src/constants/roles.js` | USER_ROLE + FRANCHISE_STATUS |
| `src/modules/auth/user.model.js` | ek account collection (role, location, franchise fields, password) |
| `src/modules/auth/auth.controller.js` | register / verify-otp / login (role aware) |
| `src/middleware/franchise.middleware.js` | requireCustomer / requireFranchise / requireApprovedFranchise |
| `src/modules/franchise/*` | franchise apply / login / customer register / loan apply / loans |
| `src/modules/admin/franchise.*` | admin list / approve / reject / tracking |
| `src/utils/sequence.js` | LOAN… / FRN… id counters |
| `src/modules/loans/shared/loanBasics.schema.js` | franchise + applicationNo fields |

---

## 8. Unified customer entry point (dashboard ka ek door)

Per-product routes waise hi hain, lekin dashboard `product` body me bhejkar ek hi
URL bhi use kar sakta hai:

```
POST /api/customer/loan-apply      (customer token)
{
  "product": "personal",
  "loanAmount": 500000, "loanTenure": 3, "employmentType": "Salaried",
  "companyName": "ABC Corp", "companyType": "Private Limited",
  "monthlySalary": 50000, "salaryReceivedAs": "Bank Transfer", "salaryBankName": "HDFC",
  "fullName": "Rahul", "mobile": "9876543210", "email": "rahul@example.com",
  "dob": "1995-05-15", "panNumber": "ABCDE1234F"
}
→ 201 { "success": true, "product": "personal",
        "data": { "applicationNo": "LOAN000001", "franchise": null, "status": "Submitted", ... } }

GET /api/customer/loans            (customer token)
→ { "userId": "…", "total": 2,
    "data": [ { "product": "personal", "count": 1, "applications": [...] },
              { "product": "business", "count": 1, "applications": [...] } ] }
```

Isse seedha pata chalta hai ki ek user ne kaunse-kaunse loans apply kiye
(Personal → LOAN000001, Business → LOAN000002). Franchise token in routes par 403.

---

## 9. Customer status tracking (naya)

Customer apne applied loans ka status / "kahan pahuncha hai" dekh sakta hai:

```
GET /api/customer/loans/:applicationNo      (customer token)
GET /api/customer/loans/LOAN000001
→ 200 { "success": true, "application": {
    "applicationNo": "LOAN000001", "product": "personal", "loanType": "Personal Loan",
    "loanAmount": 500000, "status": "Approved", "stage": "Approved",
    "stageKey": "approved", "step": 3,
    "stages": ["Application Submitted", "Under Review", "Approved"],
    "submittedAt": "…", "decisionAt": "…", "adminNote": "Verified",
    "timeline": [
      { "step": "Application Submitted", "at": "…" },
      { "step": "Approved", "at": "…" }
    ],
    "details": { ...full application... } } }

GET /api/customer/loan-status?panNumber=ABCDE1234F   (customer token)
→ { "success": true, "panNumber": "ABCDE1234F", "total": 1,
    "applications": [ { "applicationNo": "LOAN000001", "status": "Submitted",
                        "stage": "Application Submitted", ... } ] }

GET /api/customer/loans?status=Approved              (customer token, optional filter)
GET /api/customer/summary                            (customer token)
→ { "success": true, "userId": "…", "total": 1,
    "byStatus": { "Submitted": 0, "Pending": 0, "Approved": 1, "Rejected": 0 },
    "byProduct": [ { "product": "personal", "count": 1 } ],
    "recent": [ { "applicationNo": "LOAN000001", "status": "Approved", "stage": "Approved", ... } ] }
```

**Status → stage mapping:** `Submitted → Application Submitted`, `Pending → Under Review`,
`Approved → Approved`, `Rejected → Rejected`. Har read `user = req.user.id` par scoped hai.
