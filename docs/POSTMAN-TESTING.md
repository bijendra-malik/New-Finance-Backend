# Postman Testing Guide — teeno flow, request-by-request

Ye doc tumhare liye hai: Postman kholo aur neeche diye gaye request ek-ek karke chalao.
Har request me URL, method, headers, body aur expected response diya hai.

**Isme koi automated test script nahi hai** — ye manual testing ka guide hai.
(Repo me maine koi test script/Postman collection file nahi chhodi; jo commands maine
chalayi wo one-liners thi: `node --check`, `require('./src/app')`, route table print.)

---

## Step 0 — Setup (ek baar karo)

| Cheez | Value |
|---|---|
| Base URL | `http://localhost:5000` (`.env` me `PORT` ho to wahi) |
| Server start | `npm run dev` (ya `npm start`) |
| Plans seed (ek baar) | `npm run seed:franchise-plans` — warna B1 ki plans list **khaali** aayegi aur `planCode` ka koi option hi nahi milega |
| Auth header | `Authorization: Bearer <token>` |
| Content-Type | `application/json` |

**Postman me ek environment bana lo** in variables ke saath, phir har request me
`{{BASE_URL}}` / `{{token}}` use karo:

```
BASE_URL      = http://localhost:5000
token         = (verify-otp se aayega, uska response copy karke yahan paste karo)
franchiseToken= (franchise verify ya login se)
adminToken    = (admin login se)
customerId    = (register ke response se — franchise ka customer)
adminFranchiseId = (admin list se — Mongo _id)
```

### OTP kahan milega? (important)

`src/utils/sendOTP.js` abhi asli SMS nahi bhejta — **OTP server ke console/log me print
hota hai**:

```
====================================
📱 Sending OTP...
Mobile : 9876543210
OTP    : 482913
====================================
```

Do tareeke:

1. **Server log dekho** — terminal (ya `server.log`) me OTP mil jaayega.
2. **Fixed OTP chahiye** to `.env` me `SMS_PROVIDER=console` aur
   `STATIC_OTP=123456` set karke server restart karo — phir har OTP `123456`
   hi rahega (local testing ke liye). Production me `STATIC_OTP` set na karein.

**OTP ki koi expiry nahi hai** (jaan-boojh kar) — doc mobile ke saath pada rehta hai
jab tak koi naya entry usi mobile ka OTP replace na kar de, aur wahi OTP jitni baar
chaho verify kiya ja sakta hai. Sirf value match honi chahiye.

### Rate limits (Postman me baar-baar test karte waqt yaad rakho)

| Limiter | Limit | Kahan |
|---|---|---|
| OTP bhejna | 500 / 10 min **per IP** | `POST /api/auth/:product`, `/api/franchise/entry`, `/register` |
| OTP verify | **10 / 10 min per IP** | `/verify-otp` wale saare routes |
| Admin login | 10 / 15 min per IP | `/api/admin/auth/login` |

10 verify attempts ke baad `429 Too many attempts. Please try again later.` aayega —
ye block 10 minute tak rehta hai.

---

# A. CUSTOMER FLOW (7 request)

### A1. Entry — step 1: details bhejo, OTP aayega

```
POST {{BASE_URL}}/api/auth/personal-loan
Content-Type: application/json
```
```json
{
  "name": "Rahul Sharma",
  "email": "rahul@example.com",
  "mobile": "9876543210",
  "dob": "1995-05-15",
  "panNumber": "ABCDE1234F",
  "continent": "Asia",
  "country": "India"
}
```
**Expected `200`:**
```json
{
  "success": true,
  "message": "OTP sent to 98******10",
  "mobile": "9876543210",
  "mobileMasked": "98******10",
  "product": "personal",
  "loanType": "Personal Loan",
  "nextStep": "verify-otp"
}
```
**Yaad rakho:** is step par **koi account nahi banta** — details OTP document me
"pending" rehti hain. Form adhoora chhod do to DB me kuch nahi bachta.
`state`/`city`/`pincode` **ab entry form me nahi hain** — bhej doge to ignore ho jaayenge.
`mobile` poora number aata hai (wahi A2 me bhejna hai) aur `mobileMasked` screen par
dikhane ke liye hota hai.

**Ye 5 details aage tak bandhi hui hain:** `name` / `mobile` / `email` / `dob` /
`panNumber`. A4 (loan apply) me inhi ka match hona zaroori hai — warna `400`.

### A2. Entry — step 2: OTP verify → **CUST id + token**

```
POST {{BASE_URL}}/api/auth/verify-otp
```
```json
{ "mobile": "9876543210", "otp": "123456" }
```
**Expected `200`:**
```json
{
  "success": true,
  "message": "Mobile verified successfully",
  "token": "eyJhbGciOi...",
  "idType": "customer",
  "customerId": "CUST000001",
  "product": "personal",
  "loanType": "Personal Loan",
  "nextStep": "loan-apply",
  "credit": {
    "creditScore": null, "minCreditScore": 650, "eligible": false,
    "checkedAt": null, "expiresAt": null, "expired": false, "remainingSeconds": 0
  },
  "user": {
    "_id": "...", "customerId": "CUST000001", "name": "Rahul Sharma",
    "mobile": "9876543210", "email": "rahul@example.com",
    "dob": "1995-05-15", "panNumber": "ABCDE1234F",
    "continent": "Asia", "country": "India",
    "role": "customer", "isVerified": true, "isActive": true
  }
}
```
**Ye token copy karke environment me `token` me paste karo** — aage ke saare customer
calls isi se chalenge. Purane number se dobara entry karoge to **wahi CUST id** milegi.

**Naya customer ab seedha apply nahi karta** — pehle A2.5 (credit score) karna hai.
Agar customer pehle se eligible hai (score ≥ 650 aur 24h window active), to `nextStep`
`"loan-apply"` aur `credit.eligible: true` aayega.

### A2.5. Credit score — **apply se pehle ye step zaroori hai** (naya)

OTP verify hote hi customer ka score check hota hai. Score submit karne par server
faisla karta hai: eligible (≥ 650) ya not eligible (< 650).

```
POST {{BASE_URL}}/api/customer/credit-score
Authorization: Bearer {{token}}
Content-Type: application/json
```
```json
{ "creditScore": 720 }
```

**Case 1 — score ≥ 650 → ELIGIBLE + 24-hour window**
```json
{
  "success": true,
  "creditScore": 720,
  "minCreditScore": 650,
  "eligible": true,
  "checkedAt": "2026-10-17T10:15:00.000Z",
  "expiresAt": "2026-10-18T10:15:00.000Z",
  "expired": false,
  "remainingSeconds": 86399,
  "message": "You are eligible. Please submit your loan application within 24 hours."
}
```

**Case 2 — score < 650 → NOT ELIGIBLE** (HTTP status phir bhi `200`)
```json
{
  "success": true,
  "creditScore": 600,
  "minCreditScore": 650,
  "eligible": false,
  "checkedAt": "2026-10-17T10:16:00.000Z",
  "expiresAt": null,
  "expired": false,
  "remainingSeconds": 0,
  "message": "Your credit score is below 650, so you are not eligible to apply for a loan right now."
}
```

Score **300 se 900** ke beech ka integer hona chahiye — warna `400`:
`"Enter a valid credit score between 300 and 900"`.

**Current status / countdown (GET):**
```
GET {{BASE_URL}}/api/customer/credit-score
Authorization: Bearer {{token}}
```
→ wahi object (`eligible`, `expiresAt`, `remainingSeconds`, `expired`). Page refresh par
dashboard isi se countdown dikhata hai.

**Rules:**

| Condition | Apply par kya hoga |
|---|---|
| Score check hi nahi kiya | `403` "Please check your credit score before applying for a loan." |
| Score < 650 | `403` "Your credit score is below 650, so you are not eligible to apply for a loan right now." |
| Score ≥ 650, 24h ke andar | `201` application ban jaati hai |
| Score ≥ 650, 24h beet gaye | `403` "Your 24-hour application window has expired. Please login with your mobile number and check your credit score again." |
| Dobara score submit (≥ 650) | Naya 24-hour window shuru (reset) |

**24h expiry Postman me kaise test karein:** 24 ghante wait karne ki zaroorat nahi —
Mongo me window ko past me set kar do (DB ka naam `.env` se lo):

```js
// mongosh me (mobile apna test number)
db.users.updateOne(
  { mobile: "9876543210" },
  { $set: { creditEligibilityExpiresAt: new Date(Date.now() - 60000) } }
)
```

Phir `GET /api/customer/credit-score` → `eligible: false, expired: true`, aur apply → `403`
expiry wala message. Uske baad A11 (phone login) → score dobara → naya window.

### A3. Loan form ka SCREEN (GET) — fields + prefill + pehle ki application

```
GET {{BASE_URL}}/api/customer/loan-apply?product=personal&employmentType=Salaried
Authorization: Bearer {{token}}
```
**Expected `200`:**
```json
{
  "success": true,
  "product": "personal",
  "loanType": "Personal Loan",
  "employmentTypes": ["Salaried"],
  "employmentType": "Salaried",
  "fields": {
    "loanRequirements": ["loanAmount", "loanTenure"],
    "incomeDetails": ["employmentType", "companyName", "companyType", "companyTypeOther",
                      "monthlySalary", "salaryReceivedAs", "salaryReceivedAsOther",
                      "salaryBankName", "salaryBankOther"],
    "existingLoanExposure": ["existingEMI", "existingLoanAmount", "existingBanks",
                             "otherBankList", "existingLoanTypes", "otherLoanList"],
    "personalDetails": ["fullName", "mobile", "email", "dob", "panNumber", "state",
                        "city", "pincode", "residenceStatus"]
  },
  "prefill": {
    "fullName": "Rahul Sharma", "mobile": "9876543210", "email": "rahul@example.com",
    "dob": "1995-05-15", "panNumber": "ABCDE1234F",
    "continent": "Asia", "country": "India",
    "state": "", "city": "", "pincode": ""
  },
  "alreadyApplied": false,
  "canApply": true,
  "applicationNo": null,
  "data": null
}
```
**Kaam kya hai:**
- `fields` — chune hue `employmentType` ke hisaab se section-wise field names
  (Salaried → salary fields, Self Employed - Business → business fields).
  Ye **wahi names hain jo validator/schema use karta hai**.
- `prefill` — A1 entry par OTP se verify hui identity details. Form inhi se bharna hai;
  apply me inhi ka match hona zaroori hai (A4 dekho).
- `data` — pehle se bhari hui application: **jo apply karte waqt bheja tha wahi yahan**
  milta hai (`data.loanAmount`, `data.sections.incomeDetails`, …). Na ho to `null`.
- `alreadyApplied` / `canApply` — is product ka form bhara ja sakta hai ya nahi
  (ek product me ek hi direct application banti hai).

`product` galat do → `400 { "message": "A valid loan product is required" }`.

### A4. Loan submit — **sirf active 24h window me**

> ⚠️ A4 se pehle **A2.5** me score ≥ 650 submit karo. Warna yahan `403` aayega.
> Agar 24h beet gaye to pehle A11 se login karke score dobara check karo.

```
POST {{BASE_URL}}/api/customer/loan-apply
Authorization: Bearer {{token}}
```
```json
{
  "product": "personal",
  "loanAmount": 500000,
  "loanTenure": 3,
  "employmentType": "Salaried",
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 75000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1995-05-15",
  "panNumber": "ABCDE1234F"
}
```
**Sabse zaroori rule:** `fullName` + `mobile` **A1 entry wale hi hone chahiye**. `email` /
`dob` / `panNumber` bhejo to match karo — na bhejo to server khud entry wali verified value
bhar deta hai (personal loan me ye teen optional hain). Mismatch par:
```json
400 {
  "success": false,
  "message": "Mobile number does not match the details you verified at loan entry. Please use the same mobile number (9876543210)."
}
```
**Expected `201`:**
```json
{
  "success": true,
  "message": "Loan application submitted successfully.",
  "product": "personal",
  "loanType": "Personal Loan",
  "data": { "applicationNo": "LOAN000001", "...": "sanitized application document" }
}
```
`product` body me hi aata hai (per-product URL `POST /api/personal-loan/apply` bhi
waise hi chalta rahega — ye ek **extra single door** hai). `data.sections` me section-wise
values aati hain — wahi keys jo A3 ke `fields` me hain.
Same customer same product par 3 din ke andar dobara apply kare to `409` milega:
`{ "success": false, "message": "You have already applied for this loan product. Please wait 2 days, 3 hours before applying again.", "retryAfter": { "days": 2, "hours": 3, "minutes": 0, "seconds": 0, "availableAt": "2026-10-24T12:00:00.000Z" } }`.
Application submit hone ke 3 din baad wahi customer usi product ke liye dobara apply kar sakta hai.

### A5–A7. Baaki customer reads (optional)

| Request | URL | Kya milta hai |
|---|---|---|
| A5 | `GET {{BASE_URL}}/api/customer/loans` | saare applications, product-wise grouped |
| A6 | `GET {{BASE_URL}}/api/customer/loans/LOAN000001` | ek application ka status + stage + timeline |
| A7 | `GET {{BASE_URL}}/api/customer/loan-status?panNumber=ABCDE1234F` | PAN se tracking |
| A8 | `GET {{BASE_URL}}/api/customer/summary` | totals + status counts + recent 5 |
| A9 | `GET {{BASE_URL}}/api/auth/customer/profile` | apna profile |

### A10. Status door — **token ki zaroorat nahi** (CUST id + PAN + OTP)

```
POST {{BASE_URL}}/api/customer/status/request-otp
{ "customerId": "CUST000001", "panNumber": "ABCDE1234F", "mobile": "9876543210" }
→ 200 { "success": true, "message": "OTP sent to 98******10", "nextStep": "status" }

POST {{BASE_URL}}/api/customer/status
{ "mobile": "9876543210", "otp": "123456" }
→ 200 { "success": true, "total": 1,
        "byStatus": { "Submitted": 0, "Pending": 1, "Approved": 0, "Rejected": 0 },
        "stages": [ "Application Submitted", "Under Review", "Approved" ],
        "applications": [ { "applicationNo": "LOAN000001", "status": "Pending",
                            "stage": "Under Review", "step": 2, "adminNote": "…",
                            "timeline": [ … ] } ] }
```

OTP account ke registered mobile par hi jaata hai; CUST id aur PAN dono match karne chahiye
(galat ID ya galat PAN — dono par wahi `404`). Jitni baar chaho status dekh sakti ho, OTP
ki koi expiry nahi.

### A11. Customer LOGIN (phone + OTP) — window expire hone ke baad

Purana customer entry form dobara nahi bharta. Sirf mobile se login karta hai, phir score
dobara check karke koi bhi loan choose karta hai.

**Step 1 — OTP request**
```
POST {{BASE_URL}}/api/auth/login/request-otp
Content-Type: application/json
```
```json
{ "mobile": "9876543210" }
```
**200:**
```json
{ "success": true, "message": "OTP sent to 98******10", "mobileMasked": "98******10", "nextStep": "verify-otp" }
```
Naya number daaloge to `404` — pehle entry (A1) se account banana padega. Franchise number
par `400` (franchise apni ID/password se login karta hai).

**Step 2 — OTP verify → login token**
```
POST {{BASE_URL}}/api/auth/login/gold-loan/verify-otp
```
```json
{ "mobile": "9876543210", "otp": "123456" }
```
URL mein `gold-loan` ko customer ke selected product route se replace karein.
OTP sahi hone par backend URL ke product ki application ka submission time
check karta hai. Agar pichhli Gold Loan application ko 3 din nahi hue hain to
`409` aayega:
`{ "success": false, "message": "You have already applied for the Gold Loan. Please wait 2 days, 3 hours before applying again.", "retryAfter": { "days": 2, "hours": 3, "minutes": 0, "seconds": 0, "availableAt": "2026-10-24T12:00:00.000Z" } }`.
OTP consume ho jaata hai; customer 3 din baad naya login OTP lekar continue kar sakta hai.
**200:**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOi...",
  "idType": "customer",
  "customerId": "CUST000001",
  "product": "goldLoan",
  "loanType": "Gold Loan",
  "nextStep": "loan-apply",
  "user": { "customerId": "CUST000001", "name": "Rahul Sharma", "mobile": "9876543210", "...": "..." }
}
```
Login token ko `{{token}}` me replace kar lo (purana entry token kaam khatam).
Login response purane credit-score status ko nahi bhejta. Gold Loan ke liye pehle
form draft submit karo, phir us `draftId` ke saath naya score bhejo. Naya score
account par save hota hai aur submitted Gold Loan application mein uska alag
snapshot store hota hai.

**Login token me product lock NAHI hota** — lekin credit gate har apply par lagega:

```
POST {{BASE_URL}}/api/business-loan/apply      (login ke turant baad)
Authorization: Bearer {{token}}
→ 403 { "message": "Please check your credit score before applying for a loan." }

POST {{BASE_URL}}/api/customer/credit-score     { "creditScore": 700 }
→ 200 { "eligible": true, "expiresAt": "..." }

POST {{BASE_URL}}/api/business-loan/apply      (ab chalega)
→ 201 { "data": { "applicationNo": "LOAN000075" } }
```
Business ki poori body G2 / G2b me hai. Entry token (A2) par product lock rehta hai —
wo sirf usi product par apply kar sakta hai jisse entry hui thi.

---

# B. FRANCHISE FLOW (franchise banna + admin approval)

### B1. Published plans dekho (public — isse `planCode` milega)

```
GET {{BASE_URL}}/api/franchise/plans
```
**Expected `200`:**
```json
{
  "success": true,
  "count": 5,
  "bestValueCode": "3Y",
  "bestValueIsPinned": true,
  "selectedPlanCode": null,
  "plans": [
    { "code": "3Y", "name": "3-Year Plan", "durationMonths": 36, "fee": 249000,
      "gstPercent": 18, "gstAmount": 44820, "totalWithGst": 293820 },
    { "code": "1Y", "name": "Annual Plan", "fee": 119000, "totalWithGst": 140420 }
  ]
}
```
> Dhyan do: array ka naam **`plans`** hai (`data` nahi). Abhi ke seeded plans: **`3Y` · `1Y` · `6M` · `3M` · `1M`**. Problems ho to `npm run seed:franchise-plans` chala lo.

### B2. Franchise Entry — details + **plan + business**, ek hi form me

```
POST {{BASE_URL}}/api/franchise/entry
```
```json
{
  "name": "Amit Verma",
  "email": "amit@example.com",
  "mobile": "9876543222",
  "dob": "1990-01-20",
  "panNumber": "ABCDE1234F",
  "continent": "Asia",
  "country": "India",
  "pincode": "110001",
  "state": "Delhi",
  "city": "New Delhi",

  "planCode": "3Y",
  "businessName": "Amit Enterprises",
  "businessType": "Proprietorship",
  "gstNumber": "09ABCDE1234F1Z5",
  "address": "Sector 62, Noida",
  "yearsInBusiness": "3"
}
```
**Expected `200`:** `{ "success": true, "message": "OTP sent to 98******22", "mobileMasked": "98******22", "nextStep": "verify-otp" }`

**Yaad rakho:**
- `planCode` **ya** `package` — kam se kam ek zaroori hai, warna
  `400 "Please select a franchise plan before continuing"`.
- `planCode` galat/unpublished hoga to OTP bhejne se **pehle hi** `400` aa jaayega
  (plan pehle verify hota hai, surprise baad me nahi).
- `businessName`, `businessType`, `gstNumber`, `address`, `yearsInBusiness` — ye
  **sab optional** hain (recommended hain, par validation nahi rokti).
- Pehle se **approved** franchise ka number daala to:
  `409 "This mobile is already an approved franchise. Please login with your franchise ID and password."`

### B3. Franchise Entry verify → account + **franchiseStatus = Pending**

```
POST {{BASE_URL}}/api/franchise/entry/verify
```
```json
{ "mobile": "9876543222", "otp": "123456" }
```
**Expected `200`:**
```json
{
  "success": true,
  "message": "Mobile verified successfully",
  "token": "eyJ...",
  "idType": "franchise",
  "nextStep": "franchise-pending",
  "franchiseStatus": "Pending",
  "franchiseId": null,
  "package": "3-Year Plan",
  "plan": { "code": "3Y", "name": "3-Year Plan", "fee": 249000, "totalWithGst": 293820 },
  "user": { "_id": "...", "name": "Amit Verma", "dob": "1990-01-20", "isVerified": true, ... }
}
```
**Yahi bada change hai:** pehle plan alag `/apply` step me aata tha, **ab yahin** verify
par franchise Pending ban jaata hai (`nextStep: "franchise-pending"`). `franchiseId`
**null** rahega — FRN admin approve karne par milega.

### B4. Pending status check

```
GET {{BASE_URL}}/api/franchise/status
Authorization: Bearer {{franchiseToken}}
```
→ `{ "success": true, "franchiseStatus": "Pending", "canLogin": false, "message": "Your franchise application is pending admin approval.", "appliedAt": "..." }`

### B5. Admin login (approval ke liye)

```
POST {{BASE_URL}}/api/admin/auth/login
```
```json
{ "email": "admin@example.com", "password": "your-admin-password" }
```
→ `{ "success": true, "token": "eyJ..." }` → isko `{{adminToken}}` me daalo.

### B6. Admin — pending franchise ki list (yahan se Mongo `_id` milega)

```
GET {{BASE_URL}}/api/admin/franchises?status=Pending&page=1&limit=20
Authorization: Bearer {{adminToken}}
```
→ list me apna `9876543222` wala record dhoondo, uska `_id` `{{adminFranchiseId}}` me paste karo.

### B7. Admin — **Approve** (FRN + password milega)

```
PATCH {{BASE_URL}}/api/admin/franchises/{{adminFranchiseId}}/approve
Authorization: Bearer {{adminToken}}
```
Body: `{}` (ya jo bhi `admin/franchise.service.js` support kare)
**Expected `200`:** response me `credentials` object aata hai:
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
  "franchise": { "franchiseStatus": "Approved", "franchiseId": "FRN000001" }
}
```
Body khaali `{}` chalega — approve ko koi field nahi chahiye. Isi `loginId` + `password` se B8 ka login hota hai.

### B8. Franchise login (approved hone ke baad)

```
POST {{BASE_URL}}/api/franchise/login
```
```json
{ "franchiseId": "FRN000001", "password": "ABCDE1234F" }
```
→ `{ "success": true, "token": "eyJ...", "franchise": {...} }` → `{{franchiseToken}}` me daalo.

### B9. Status dobara (approved ab)

```
GET {{BASE_URL}}/api/franchise/status
Authorization: Bearer {{franchiseToken}}
```
→
```json
{
  "success": true,
  "franchiseStatus": "Approved",
  "canLogin": true,
  "message": "Your franchise is approved. Please login with the franchise ID and password shared by the admin.",
  "approvedAt": "..."
}
```
**Note:** yahan **na ID, na password** dikhta hai (tumne kaha tha) — sirf "admin se mile
credentials se login karo".

### B10. Rejection test (alag number par)

```
PATCH {{BASE_URL}}/api/admin/franchises/{{pendingFranchiseId}}/reject
Authorization: Bearer {{adminToken}}
```
```json
{ "note": "PAN and business name do not match" }
```
Phir **us** franchise ke token se:
```
GET {{BASE_URL}}/api/franchise/status
```
→
```json
{
  "success": true,
  "franchiseStatus": "Rejected",
  "canLogin": false,
  "rejectionReason": "PAN and business name do not match",
  "message": "Your franchise application was rejected. Reason: PAN and business name do not match"
}
```
`note` khaali chhoda to message ban jaata hai: *"…rejected. Please contact support for the reason."*

### B11. Franchise apne loans dekhe (approved only)

```
GET {{BASE_URL}}/api/franchise/loans
Authorization: Bearer {{franchiseToken}}
```
→ `{ "success": true, "franchiseId": "FRN000001", "total": N, "data": [...] }`

---

# C. FRANCHISE → apna CUSTOMER (OTP wala flow)

> Ye tab chalta hai jab franchise **Approved** ho (`requireApprovedFranchise`).
> Pending/rejected token se `403` aayega — ye bhi test kar lo.

### C1. Customer register (ab OTP bhejta hai)

```
POST {{BASE_URL}}/api/franchise/customer/register
Authorization: Bearer {{franchiseToken}}
```
```json
{
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "panNumber": "ABCDE1234F",
  "dob": "1995-05-15",
  "email": "rahul@example.com",
  "state": "Punjab",
  "city": "Ludhiana",
  "pincode": "141001"
}
```
**Expected `201`:**
```json
{
  "success": true,
  "message": "Customer saved. An OTP has been sent to the customer's mobile (9876543210) for verification.",
  "nextStep": "verify-otp",
  "data": { "_id": "<FRANCHISE_CUSTOMER_ID>", "fullName": "Rahul Sharma", "isVerified": false, "verifiedAt": null, ... }
}
```
`data._id` copy karo — `{{customerId}}`.

**Yaad rakho:**
- `email` ab **zaroori** hai (pehle optional tha).
- Mobile **customer ka** hona chahiye: franchise ke apne number/dusre franchise ke customer
  ke number par `400 "This mobile belongs to a franchise account"` / `409 "already registered"`.
- Same franchise ke under wahi mobile dobara → `409`.

### C2. Customer ka OTP verify (naya step)

```
POST {{BASE_URL}}/api/franchise/customer/verify-otp
Authorization: Bearer {{franchiseToken}}
```
```json
{ "franchiseCustomerId": "{{customerId}}", "otp": "123456" }
```
**Expected `200`:**
```json
{
  "success": true,
  "message": "Customer mobile verified successfully.",
  "customer": { "_id": "...", "isVerified": true, "verifiedAt": "..." },
  "customerId": "CUST000002",
  "nextStep": "loan-apply"
}
```
**Iske bina loan nahi**: C3 try karo aur `403 "Customer mobile is not verified..."` dekho.

### C3. Loan apply (product **URL** me)

```
POST {{BASE_URL}}/api/franchise/customer/personal/applyloan
Authorization: Bearer {{franchiseToken}}
```
```json
{
  "franchiseCustomerId": "{{customerId}}",
  "loanAmount": 500000,
  "loanTenure": 3,
  "employmentType": "Salaried",
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 75000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank"
}
```
**Expected `202`:**
```json
{
  "success": true,
  "product": "personal",
  "nextStep": "credit-score",
  "franchiseCustomerId": "...",
  "draft": { "draftId": "<UUID>", "expiresAt": "..." }
}
```
- `fullName`/`mobile`/`PAN`/`DOB`/`email` **body me nahi bhejne** — wo customer profile se aate hain.
- Ab `POST /api/franchise/customer/{{customerId}}/credit-score` par `{ "draftId": "<UUID>", "creditScore": 720 }` bhejein; `>= 600` par application submit hogi.
- URL segment kaafi flexible hai: `personal`, `personal-loan`, `personalloan`, `gold-loan`,
  `credit-card`, `loan-against-property` … sab resolve ho jaate hain. Galat segment →
  `400` with the list of valid product keys.

### C4–C6. Customer ke baad ke calls

| Request | URL |
|---|---|
| C4 | `GET {{BASE_URL}}/api/franchise/customer?search=rahul&page=1&limit=10` |
| C5 | `GET {{BASE_URL}}/api/franchise/customer/{{customerId}}` |
| C6 | `GET {{BASE_URL}}/api/franchise/customer/{{customerId}}/loans` |
| C7 | `GET {{BASE_URL}}/api/franchise/customer/{{customerId}}/loans/LOAN000002` |
| C8 | `PATCH {{BASE_URL}}/api/franchise/customer/{{customerId}}` (body me sirf badalne wale fields) |

---

# D. Negative tests (status code check karo — ye hi asli verification hai)

| # | Kya bhejo | Kahan | Expected |
|---|---|---|---|
| D1 | DOB making applicant younger than 18 or older than 65 | `POST /api/auth/personal-loan` | `400` "Applicant must be between 18 and 65 years old to apply for a loan" |
| D2 | `panNumber: "abc"` | same | `400` PAN message |
| D3 | `POST /api/auth/register` (purana route) | | **`400`** "A valid loan product is required (one of: personal, business, …)" — 404 nahi |
| D4 | `POST /api/auth/login` (purana route) | | **`400`** (upar jaisa hi message) |
| D5 | `POST /api/customer/apply-register` | | `404` (hata diya) |
| D6 | `POST /api/franchise/apply` | | `404` (hata diya) |
| D7 | galat OTP (`000000`) | `POST /api/auth/verify-otp` | `400` "Invalid OTP" |
| D8 | OTP kai din purana (expiry nahi hai) | same | `200` — wahi OTP dobara verify ho jaata hai |
| D9 | customer OTP franchise ke route par | `POST /api/franchise/entry/verify` | `400` "This OTP was sent for a different entry. Please start again." |
| D10 | `applyloan` bina verify kiye customer ka | `POST /api/franchise/customer/personal/applyloan` | `403` |
| D11 | customer token se franchise route | `GET /api/franchise/loans` | `403` |
| D12 | franchise token se customer route | `GET /api/customer/loans` | `403` |
| D13 | token hi nahi bheja | koi bhi protected route | `401` |
| D14 | `GET /api/franchise/customer/<dusri franchise ka id>` | | `404` (scoped) |
| D15 | `planCode` khaali + `package` khaali | `POST /api/franchise/entry` | `400` "Please select a franchise plan before continuing" |
| D16 | galat product (Bearer token ke saath) | `POST /api/customer/loan-apply` | `400` "A valid loan product is required" — token ke bina pehle `401` aayega |
| D17 | status door par galat PAN (ya anjaan CUST id) | `POST /api/customer/status/request-otp` | `404` "Customer ID and PAN do not match our records." |
| D18 | status door par galat OTP | `POST /api/customer/status` | `400` "Invalid OTP" |

> **D3/D4 kyun 400 dete hain (404 nahi):** `POST /api/auth/:product` ek dynamic route hai,
> isliye `register` ya `login` bhi uske liye ek "product" ban jaata hai — aur product validate
> hone par `400` aa jaata hai. Route **kaam nahi karta** (koi register/login nahi hota), bas
> status code 404 ki jagah 400 hai. Ye behaviour maine asli server par check kiya hai:
> `/api/auth/login/verify`, `/api/customer/apply-register`, `/api/franchise/apply` — teeno
> **asli 404** dete hain (`Cannot POST ...`), kyunki wo do segment wale hain.

---

# E. Saare 18 entry URLs (`POST /api/auth/<ye>`)

| # | URL | product key |
|---|---|---|
| 1 | `/api/auth/personal-loan` | `personal` |
| 2 | `/api/auth/business-loan` | `business` |
| 3 | `/api/auth/home-loan` | `home` |
| 4 | `/api/auth/commercial-purchase` | `commercialPurchase` |
| 5 | `/api/auth/loan-against-property` | `lap` |
| 6 | `/api/auth/working-capital` | `workingCapital` |
| 7 | `/api/auth/od-cc-limit` | `odCcLimit` |
| 8 | `/api/auth/loan-against-share` | `loanAgainstShare` |
| 9 | `/api/auth/film-funding` | `filmFunding` |
| 10 | `/api/auth/fdi-loan` | `fdiLoan` |
| 11 | `/api/auth/lease-rental-discounting` | `leaseRentalDiscounting` |
| 12 | `/api/auth/balance-transfer` | `balanceTransfer` |
| 13 | `/api/auth/project-loan` | `projectLoan` |
| 14 | `/api/auth/vehicle-loan` | `vehicleLoan` |
| 15 | `/api/auth/education-loan` | `educationLoan` |
| 16 | `/api/auth/gold-loan` | `goldLoan` |
| 17 | `/api/auth/npa-loan` | `npaLoan` |
| 18 | `/api/auth/credit-card` | `creditCard` |

Sabka body **bilkul same** hai (A1 wala). Bas URL badalta hai — `product` URL se hi
resolve hota hai aur response me `loanType` aa jaata hai.

---

## F. Testing order (isse follow karo, warna 403/404 me ulajh jaogi)

```
A1 → A2 (token) → A2.5 (score) → A3 → A4       (customer ka poora darwaza)
A11 (login) → A2.5 (re-check) → G2b            (window expire / doosra product)
B1 → B2 → B3 (franchise token) → B5 (admin token) → B6 → B7 → B8 (naya token) → B9
C1 (customerId) → C2 → C3 → C6                 (franchise ka customer)
D  (negative cases — 10 min me 10 se zyada verify na karo)
```

Ek request ka response kabhi na aaye to pehle **server log** dekho — OTP, validation
errors aur MongoDB connection wahi dikhte hain.

---

# G. Har loan product ki READY body (all fields filled)

Sab bodies `POST {{BASE_URL}}/api/customer/loan-apply` par jaati hain
(header: `Authorization: Bearer {{token}}` + `Content-Type: application/json`).
Token A2 (verify-otp) se aayega. Sirf body copy-paste karo — values already valid hain.

**Sabse pehla rule:** neeche har body me `Rahul Sharma` / `9876543210` likha hai. Ye **A1/A2
wale customer ki hi details** honi chahiye — `fullName` + `mobile` compulsory, aur
`email` / `dob` / `panNumber` bhejo to match karo. Warna `400` aata hai. Apne number par
test kar rahe ho to sirf ye 5 values apne entry wale values se badal do.

**Baaki 4 rule:**
1. `loanTenure` hamesha **YEARS** me hai.
2. Koi bhi dropdown "Other" chuna ho to uska `*Other` free-text field bhi bhejo
   (jaise `companyType: "Other"` + `companyTypeOther: "Chhota business"`).
3. `salaryReceivedAs: "Cash"` ho to `salaryBankName` chhod sakte ho.
4. "employment" wale products (home, lap, …) me `employmentType` teeno me se
   koi bhi ho sakta hai — Salaried ho to salary fields, Business ho to business
   fields required hote hain. Neeche sab me Salaried variant diya hai; Business
   variant ka block sirf #2 (business) me poora hai, usi ko copy kar lena.

### G1. Personal Loan (`personal`) — sirf Salaried
```json
{
  "product": "personal",
  "loanAmount": 500000,
  "loanTenure": 3,
  "employmentType": "Salaried",
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 75000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210"
}
```
(email/dob/PAN yahan optional hain — sirf name+mobile compulsory)

### G2. Business Loan (`business`) — Self Employed - Business (sabse lambi body)
```json
{
  "product": "business",
  "loanAmount": 2000000,
  "loanTenure": 5,
  "employmentType": "Self Employed - Business",
  "businessType": "Private Limited",
  "businessName": "Sharma Traders",
  "companyPanNumber": "ABCDE1234F",
  "gstNumber": "22AAAAA0000A1Z5",
  "natureOfBusiness": "Trading",
  "industryType": "Retail",
  "businessEstablishedDate": "2015-06-01",
  "lastYearTurnover": 5000000,
  "lastYearNetIncome": 800000,
  "businessState": "Maharashtra",
  "businessCity": "Mumbai",
  "businessPincode": "400001",
  "businessPlaceStatus": "Owned",
  "transactionBankName": "HDFC Bank",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```
(Professional variant: `employmentType: "Self Employed - Professional"` + `profession`,
`currentYearTurnover`, `priorYearTurnover`, `currentYearNetIncome`,
`previousYearNetIncome` — business* fields hata do, business address + bank rakho)

### G2b. NAYA CUSTOMER -> Business Loan ka poora process (saare fields)

"New customer" ka matlab bas itna: **mobile + email naye** (kisi purane customer ka number
use karoge to wahi CUST id milega aur purani application ki wajah se `409` aa sakta hai).
Chaar request, isi order me. OTP static hai: **123456**.

**1) Entry** — `POST {{BASE_URL}}/api/auth/business-loan`
```json
{
  "name": "Naya Customer Business",
  "email": "naya.customer.business@example.com",
  "mobile": "9876543220",
  "dob": "1988-11-11",
  "panNumber": "NEWCU1234B",
  "continent": "Asia",
  "country": "India"
}
```
**200:** `{ success, message, mobile, mobileMasked, product: "business", loanType: "Business Loan", nextStep: "verify-otp" }`
(email/dob/PAN yahan se account par save hote hain — aage apply me inhi ka match chahiye.)

**2) OTP verify** — `POST {{BASE_URL}}/api/auth/verify-otp`
```json
{ "mobile": "9876543220", "otp": "123456" }
```
**200:** `token` + `customerId` (jaise `CUST000039`) + `nextStep: "credit-score"`.
Token ko environment me `{{token}}` me rakh lo.

**2b) Credit score (naya step — iske bina apply 403 dega)** —
`POST {{BASE_URL}}/api/customer/credit-score` + `Authorization: Bearer {{token}}`
```json
{ "creditScore": 700 }
```
→ `200 { "eligible": true, "expiresAt": "...", "remainingSeconds": 86399 }`.
Agar `600` bheja to `eligible: false` aur apply par `403` ("below 650").

**3) Form ka screen (optional, par useful)** —
`GET {{BASE_URL}}/api/customer/loan-apply?product=business&employmentType=Self%20Employed%20-%20Business`
→ `fields` (kaunse field aate hain), `prefill` (entry wali verified details),
`alreadyApplied: false`, `canApply: true`, `data: null`.

**4) Apply — SAARE fields** — `POST {{BASE_URL}}/api/customer/loan-apply`
```json
{
  "product": "business",
  "loanAmount": 2500000,
  "loanTenure": 5,
  "employmentType": "Self Employed - Business",

  "businessType": "Private Limited",
  "businessTypeOther": "",
  "businessName": "Naya Traders Pvt Ltd",
  "gstNumber": "27NEWCU1234B1Z5",
  "companyPanNumber": "NEWCU1234B",
  "natureOfBusiness": "Trading",
  "natureOfBusinessOther": "",
  "industryType": "Retail",
  "industryTypeOther": "",
  "subIndustry": "FMCG Distribution",
  "businessEstablishedDate": "2015-06-01",
  "transactionBankName": "HDFC Bank",
  "transactionBankOther": "",
  "lastYearTurnover": 5000000,
  "last2YearsTurnover": 4200000,
  "lastYearNetIncome": 800000,
  "last2YearsNetIncome": 650000,
  "businessState": "Maharashtra",
  "businessCity": "Mumbai",
  "businessPincode": "400001",
  "businessPincodeOther": "",
  "businessPlaceStatus": "Owned",
  "businessPlaceStatusOther": "",

  "existingEMI": 12000,
  "existingLoanAmount": 500000,
  "existingBanks": ["HDFC Bank", "ICICI Bank"],
  "otherBankList": ["Naya Bank"],
  "existingLoanTypes": ["Home Loan", "Car Loan"],
  "otherLoanList": ["Gold Loan"],

  "fullName": "Naya Customer Business",
  "mobile": "9876543220",
  "email": "naya.customer.business@example.com",
  "dob": "1988-11-11",
  "panNumber": "NEWCU1234B",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```
**201:**
```json
{
  "success": true,
  "message": "Loan application submitted successfully.",
  "product": "business",
  "loanType": "Business Loan",
  "data": { "applicationNo": "LOAN000045", "status": "Submitted", "franchise": null, "sections": { "...": "section-wise bhari hui values" } }
}
```
Uske baad: `GET /api/customer/loan-apply?product=business` par `alreadyApplied: true` +
poora `data`, aur admin me `GET /api/admin/business-loans` par wahi application.

**Field ka breakdown (business loan me client 41 fields bhej sakta hai):**

| Section | Fields |
|---|---|
| Loan | `loanAmount`, `loanTenure`, `employmentType` |
| Income (business) | `businessType`(+`Other`), `businessName`, `companyPanNumber`, `gstNumber`, `natureOfBusiness`(+`Other`), `industryType`(+`Other`), `subIndustry`, `businessEstablishedDate`, `transactionBankName`(+`Other`), `lastYearTurnover`, `last2YearsTurnover`, `lastYearNetIncome`, `last2YearsNetIncome`, `businessState`, `businessCity`, `businessPincode`(+`Other`), `businessPlaceStatus`(+`Other`) |
| Exposure | `existingEMI`, `existingLoanAmount`, `existingBanks`, `otherBankList`, `existingLoanTypes`, `otherLoanList` |
| Personal | `fullName`, `mobile`, `email`, `dob`, `panNumber`, `state`, `city`, `pincode`, `residenceStatus` |

**Professional variant (dusra employment type)** — `Self Employed - Professional` chuna to
business* fields ki jagah ye 5 aate hain: `profession`, `currentYearTurnover`,
`priorYearTurnover`, `currentYearNetIncome`, `previousYearNetIncome`
(business address + `transactionBankName` waise hi rahenge).

**Rules yaad rakho:**
1. `fullName` / `mobile` **entry wale hi** hone chahiye (aur `email`/`dob`/`panNumber`
   bhejo to match karo) — warna `400` "…does not match the details you verified at loan entry".
2. `*Other` fields sirf tab bharni hoti hain jab dropdown me **"Other"** chuno — warna `""` chhod do.
3. `transactionBankDisplayName` **mat bhejo** — wo server khud banata hai (response me dikhta hai).
   `transactionBankOther` bhejo to wo bank object me merge ho jaata hai (alag se store nahi hota).
4. `loanTenure` hamesha **YEARS** me.
5. Server-owned fields (`status`, `applicationNo`, `approvedBy`, `franchise`, `franchiseCode`,
   `createdAt` …) bhejne ki zaroorat nahi — ignore ho jaate hain.
6. `businessEstablishedDate` `YYYY-MM-DD` ya `DD/MM/YYYY` — dono chalta hai.
7. Ek product me ek hi direct application: dobara POST karoge to `409`.

### G3. Home Loan (`home`)
```json
{
  "product": "home",
  "loanAmount": 8000000,
  "loanTenure": 20,
  "employmentType": "Salaried",
  "companyName": "TCS",
  "companyType": "Private Limited",
  "monthlySalary": 150000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "SBI",
  "buyingPropertyType": "Flat",
  "buyingPropertyAge": 2,
  "buyingPropertyState": "Maharashtra",
  "buyingPropertyCity": "Pune",
  "buyingPropertyPincode": "411001",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Pune",
  "pincode": "411001",
  "residenceStatus": "Owned"
}
```
(buyingProperty* fields optional hain — bhejoge to validate honge; tenure is an unrestricted whole number)

### G4. Commercial Purchase (`commercialPurchase`) — home + market value
```json
{
  "product": "commercialPurchase",
  "loanAmount": 15000000,
  "loanTenure": 10,
  "employmentType": "Salaried",
  "companyName": "TCS",
  "companyType": "Private Limited",
  "monthlySalary": 200000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "ICICI Bank",
  "buyingPropertyType": "Shop",
  "buyingPropertyMarketValue": 20000000,
  "buyingPropertyAge": 1,
  "buyingPropertyState": "Maharashtra",
  "buyingPropertyCity": "Mumbai",
  "buyingPropertyPincode": "400001",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```

### G5. Loan Against Property (`lap`) — collateral ZAROORI, salary > 12000
```json
{
  "product": "lap",
  "loanAmount": 2500000,
  "loanTenure": 10,
  "employmentType": "Salaried",
  "existingEMI": 15000,
  "existingLoanAmount": 300000,
  "collateralPropertyType": "Residential Flat",
  "collateralPropertyMarketValue": 6000000,
  "collateralPropertyAge": 8,
  "collateralPropertyState": "Maharashtra",
  "collateralPropertyCity": "Mumbai",
  "collateralPropertyPincode": "400001",
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 90000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "gstNumber": "22AAAAA0000A1Z5",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```
(exposure (`existingEMI` + `existingLoanAmount`) yahan ZAROORI hai — 0 bhej sakte ho;
dob 18+ hona chahiye; amount min ₹1,00,000)

### G6. Working Capital (`workingCapital`) — LAP wala collateral section
```json
{
  "product": "workingCapital",
  "loanAmount": 1000000,
  "loanTenure": 5,
  "employmentType": "Self Employed - Business",
  "existingEMI": 0,
  "existingLoanAmount": 0,
  "collateralPropertyType": "Commercial Property",
  "collateralPropertyMarketValue": 4000000,
  "collateralPropertyAge": 5,
  "collateralPropertyState": "Gujarat",
  "collateralPropertyCity": "Ahmedabad",
  "collateralPropertyPincode": "380001",
  "businessType": "Partnership",
  "businessName": "Patel Industries",
  "companyPanNumber": "AAAAA1111A",
  "gstNumber": "24AAAAA1111A1Z5",
  "natureOfBusiness": "Manufacturing",
  "industryType": "Textiles",
  "businessEstablishedDate": "2012-03-15",
  "lastYearTurnover": 12000000,
  "lastYearNetIncome": 1500000,
  "businessState": "Gujarat",
  "businessCity": "Ahmedabad",
  "businessPincode": "380001",
  "businessPlaceStatus": "Owned",
  "transactionBankName": "SBI",
  "fullName": "Jayesh Patel",
  "mobile": "9876543211",
  "email": "jayesh@example.com",
  "dob": "1985-08-20",
  "panNumber": "AAAAA1111A",
  "state": "Gujarat",
  "city": "Ahmedabad",
  "pincode": "380001",
  "residenceStatus": "Owned"
}
```

### G7. OD / CC Limit (`odCcLimit`)
```json
{
  "product": "odCcLimit",
  "loanAmount": 1500000,
  "loanTenure": 5,
  "employmentType": "Salaried",
  "existingEMI": 10000,
  "existingLoanAmount": 200000,
  "collateralPropertyType": "Residential House",
  "collateralPropertyMarketValue": 5000000,
  "collateralPropertyAge": 10,
  "collateralPropertyState": "Maharashtra",
  "collateralPropertyCity": "Nagpur",
  "collateralPropertyPincode": "440001",
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 85000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "Axis Bank",
  "gstNumber": "27AAAAA0000A1Z4",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Nagpur",
  "pincode": "440001",
  "residenceStatus": "Owned"
}
```

### G8. Loan Against Share (`loanAgainstShare`)
```json
{
  "product": "loanAgainstShare",
  "loanAmount": 500000,
  "loanTenure": 3,
  "employmentType": "Salaried",
  "existingEMI": 0,
  "existingLoanAmount": 0,
  "shareCompanyName": "Reliance Industries",
  "valueOfOneShare": 2500,
  "quantityOfShare": 400,
  "totalShareValue": 1000000,
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 90000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "gstNumber": "22AAAAA0000A1Z5",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```

### G9. Film Funding (`filmFunding`) — own investment ≥ 20% of cost
```json
{
  "product": "filmFunding",
  "loanAmount": 10000000,
  "loanTenure": 5,
  "employmentType": "Salaried",
  "existingEMI": 0,
  "existingLoanAmount": 0,
  "filmComesUnder": "Bollywood",
  "filmLanguages": ["Hindi", "English"],
  "starCastNames": ["Actor A", "Actor B"],
  "totalProjectCost": 50000000,
  "ownInvestmentAmount": 15000000,
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 100000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "gstNumber": "22AAAAA0000A1Z5",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```
(`filmLanguages` / `starCastNames` array ya CSV string dono chalte hain)

### G10. FDI Loan (`fdiLoan`) — amount min ₹100 CRORE
```json
{
  "product": "fdiLoan",
  "loanAmount": 1000000000,
  "loanTenure": 7,
  "employmentType": "Salaried",
  "existingEMI": 0,
  "existingLoanAmount": 0,
  "collateralPropertyType": "Industrial Land",
  "collateralPropertyMarketValue": 1500000000,
  "collateralPropertyAge": 3,
  "collateralPropertyState": "Maharashtra",
  "collateralPropertyCity": "Mumbai",
  "collateralPropertyPincode": "400001",
  "companyName": "Big Corp Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 300000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "gstNumber": "22AAAAA0000A1Z5",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1988-01-01",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```

### G11. Lease Rental Discounting (`leaseRentalDiscounting`) — lease location ZAROORI
```json
{
  "product": "leaseRentalDiscounting",
  "loanAmount": 2000000,
  "loanTenure": 5,
  "employmentType": "Salaried",
  "existingEMI": 0,
  "existingLoanAmount": 0,
  "monthlyLeaseIncome": 80000,
  "totalLeaseAmount": 9600000,
  "leasePropertyDuration": 9,
  "leasePropertyMarketValue": 5000000,
  "leasePropertyAge": 4,
  "leasePropertyState": "Karnataka",
  "leasePropertyCity": "Bengaluru",
  "leasePropertyPincode": "560001",
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 110000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "Kotak Bank",
  "gstNumber": "29AAAAA0000A1Z3",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Karnataka",
  "city": "Bengaluru",
  "pincode": "560001",
  "residenceStatus": "Owned"
}
```

### G12. Balance Transfer (`balanceTransfer`)
```json
{
  "product": "balanceTransfer",
  "loanAmount": 3000000,
  "loanTenure": 15,
  "employmentType": "Salaried",
  "balanceTransferType": "Home Loan",
  "currentPropertyValue": 5000000,
  "topUpAmount": 500000,
  "companyName": "TCS",
  "companyType": "Private Limited",
  "monthlySalary": 120000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "SBI",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```
(ye product "employment" type ka hai — Self Employed bhi apply kar sakta hai;
gst/18+ rules is par off hain)

### G13. Project Loan (`projectLoan`)
```json
{
  "product": "projectLoan",
  "loanAmount": 5000000,
  "loanTenure": 7,
  "employmentType": "Salaried",
  "projectType": "Commercial Complex",
  "totalProjectCost": 30000000,
  "projectStartDate": "2026-01-01",
  "projectCompletionDate": "2027-06-30",
  "ownInvestment": 5000000,
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 100000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```

### G14. Vehicle Loan (`vehicleLoan`) — vehicle fields sab optional
```json
{
  "product": "vehicleLoan",
  "loanAmount": 900000,
  "loanTenure": 5,
  "employmentType": "Salaried",
  "vehicleType": "New Car",
  "transmissionType": "Automatic",
  "fuelType": "Petrol",
  "manufacturer": "Maruti Suzuki",
  "model": "Swift",
  "vehiclePurchaseType": "Dealer",
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 70000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1995-03-12",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Rented"
}
```

### G15. Education Loan (`educationLoan`) — saare education fields ZAROORI
```json
{
  "product": "educationLoan",
  "loanAmount": 2000000,
  "loanTenure": 8,
  "employmentType": "Salaried",
  "educationCountry": "India",
  "fieldOfStudy": "Engineering",
  "courseName": "B.Tech",
  "university": "IIT Bombay",
  "instituteName": "IIT Bombay",
  "enrollmentStatus": "Confirmed",
  "courseDuration": 4,
  "educationCost": 2000000,
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 90000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1998-07-05",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```

### G16. Gold Loan (`goldLoan`) — gold hi collateral hai
```json
{
  "product": "goldLoan",
  "loanAmount": 2000000,
  "loanTenure": 3,
  "employmentType": "Salaried",
  "existingEMI": 0,
  "existingLoanAmount": 0,
  "typeOfLoan": "Jewellery",
  "goldCarats": "22",
  "goldWeight": 50,
  "collateralPropertyMarketValue": 3000000,
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 50000,
  "salaryReceivedAs": "Cash",
  "gstNumber": "22AAAAA0000A1Z5",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1990-05-10",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```
(salary min 12001 — Cash chuna hai isliye `salaryBankName` chhoda; 50000 > 12001 OK)

### G17. NPA Loan (`npaLoan`) — loanAmount/tenure optional (existing account describe karte hain)
```json
{
  "product": "npaLoan",
  "employmentType": "Salaried",
  "existingEMI": 25000,
  "existingLoanAmount": 1500000,
  "npaStatus": "Sub-Standard",
  "npaPrincipalLoanAmount": 1500000,
  "npaCurrentOutstandingAmount": 1200000,
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 60000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "gstNumber": "22AAAAA0000A1Z5",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1987-11-30",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```

### G18. Credit Card (`creditCard`) — loanAmount/tenure optional
```json
{
  "product": "creditCard",
  "employmentType": "Salaried",
  "hasActiveCard": "No",
  "applyForBank": "HDFC Bank",
  "companyName": "ABC Pvt Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 60000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC Bank",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "dob": "1996-01-15",
  "panNumber": "ABCDE1234F",
  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Rented"
}
```

**Success response (sab products ke liye same):**
```json
{
  "success": true,
  "product": "personal",
  "loanType": "Personal Loan",
  "data": { "applicationNo": "LOAN000001", "status": "Submitted", "...": "..." }
}
```
---

# H. GET endpoints — request kya hai aur response kya aayega

### H1. Loan form ka screen (token customer ka)
```
GET {{BASE_URL}}/api/customer/loan-apply?product=home&employmentType=Salaried
Authorization: Bearer {{token}}
```
Response (fields + entry ki verified details + bhari hui application):
```json
{
  "success": true,
  "product": "home",
  "loanType": "Home Loan",
  "employmentTypes": ["Salaried", "Self Employed - Business", "Self Employed - Professional"],
  "employmentType": "Salaried",
  "fields": {
    "loanRequirements": ["loanAmount", "loanTenure", "buyingPropertyType", "..."],
    "incomeDetails": ["employmentType", "companyName", "..."],
    "existingLoanExposure": ["existingEMI", "existingLoanAmount", "..."],
    "personalDetails": ["fullName", "mobile", "email", "dob", "panNumber", "state", "city", "pincode", "residenceStatus"]
  },
  "prefill": { "fullName": "Rahul Sharma", "mobile": "9876543210", "...": "entry par verify hui details" },
  "alreadyApplied": false,
  "canApply": true,
  "applicationNo": null,
  "data": null
}
```
Poora example + explanation **A3** me hai.
(`product` ki value: G-section wale keys — personal, business, home, lap, goldLoan …)

### H2. Meri saari applications (token customer ka)
```
GET {{BASE_URL}}/api/customer/loans              (sab)
GET {{BASE_URL}}/api/customer/loans?status=Approved   (filter)
```
Response — product ke group me:
```json
{
  "success": true,
  "userId": "652f...",
  "total": 2,
  "data": [
    { "product": "personal", "count": 1, "applications": [ { "applicationNo": "LOAN000001", "status": "Submitted", "loanAmount": 500000, "...": "..." } ] },
    { "product": "home", "count": 1, "applications": [ { "...": "..." } ] }
  ]
}
```

### H3. Ek application ka status (applicationNo = LOAN000001)
```
GET {{BASE_URL}}/api/customer/loans/LOAN000001
Authorization: Bearer {{token}}
```
Response: `{ "success": true, "application": { "applicationNo": "LOAN000001", "status": "Submitted", "stage": "...", "history": [...] } }`

### H4. PAN se track (bina login nahi — token chahiye)
```
GET {{BASE_URL}}/api/customer/loan-status?panNumber=ABCDE1234F
Authorization: Bearer {{token}}
```

### H5. Dashboard summary
```
GET {{BASE_URL}}/api/customer/summary
Authorization: Bearer {{token}}
```
Response: totals + status ke hisaab se counts + recent applications.

### H6. Profiles
```
GET {{BASE_URL}}/api/auth/customer/profile     (customer token)
GET {{BASE_URL}}/api/auth/franchise/profile    (franchise token)
GET {{BASE_URL}}/api/auth/profile              (jo bhi token ho, usi ke collection se)
```

### H7. Franchise plans (PUBLIC — bina token)
```
GET {{BASE_URL}}/api/franchise/plans
```
Response:
```json
{
  "success": true,
  "count": 5,
  "bestValueCode": "3Y",
  "bestValueIsPinned": true,
  "selectedPlanCode": null,
  "plans": [
    {
      "code": "3Y",
      "name": "3-Year Plan",
      "fee": 249000,
      "gstPercent": 18,
      "validityLabel": "3 Years",
      "gstAmount": 44820,
      "totalWithGst": 293820,
      "effectiveMonthlyCost": 6916.67,
      "renewalText": "₹4,999"
    }
  ]
}
```
(`selectedPlanCode` tab bhar jaata hai jab URL me `?plan=3Y` laga ho)

### H8. Franchise ke reads (franchise token)
```
GET {{BASE_URL}}/api/franchise/profile     entry data + franchiseStatus
GET {{BASE_URL}}/api/franchise/status      sirf approval status
GET {{BASE_URL}}/api/franchise/loans       is FRN se bane loans (sirf APPROVED franchise)
```

### H9. Franchise ke customers (APPROVED franchise token)
```
GET {{BASE_URL}}/api/franchise/customer                          ?search=&page=&limit=
GET {{BASE_URL}}/api/franchise/customer/:id                      poori detail
GET {{BASE_URL}}/api/franchise/customer/:id/loans                uske saare loans
GET {{BASE_URL}}/api/franchise/customer/:id/loans/LOAN000001     ek loan ka status
```

---

# I. ADMIN side — saari API URLs (sab par `Authorization: Bearer {{adminToken}}`)

Pehle login karo (ye ek hi baar):
```
POST {{BASE_URL}}/api/admin/auth/login
{ "email": "admin@indexiafinance.com", "password": "Admin@123" }
```
Response me `token` — wo Postman environment me `adminToken` me paste karo.
(Default creds `npm run seed:admin` se bante hain; `.env` ke ADMIN_SEED_* se badal sakte ho.)

### I1. Auth
| Method | URL | Body / note |
|---|---|---|
| POST | `/api/admin/auth/login` | `{ email, password }` → token |
| POST | `/api/admin/auth/forgot-password` | `{ email }` → OTP email me |
| POST | `/api/admin/auth/reset-password` | `{ email, otp, newPassword }` |
| GET | `/api/admin/auth/profile` | — |
| PUT | `/api/admin/auth/profile` | `{ name, email }` |
| PUT | `/api/admin/auth/change-password` | `{ currentPassword, newPassword }` |

### I2. Dashboard
| GET | `/api/admin/dashboard/stats` | totals + status counts (15 fan-out ki jagah ek call) |

### I3. Loan applications — har product ka resource
Har product ke 4 endpoint hain (`{resource}` neeche table me):
| GET | `/api/admin/{resource}` | saari applications, newest first |
| GET | `/api/admin/{resource}/:id` | ek application (Mongo _id) |
| PATCH | `/api/admin/{resource}/:id/status` | `{ "status": "Approved", "note": "OK" }` |
| DELETE | `/api/admin/{resource}/:id` | delete |

`status` ki allowed values: `Submitted`, `Pending`, `Approved`, `Rejected`
(transition rules loanStatus.js me hain — galat transition par 400).
`note` optional, max 500 chars. Approve/reject par `approvedBy/approvedAt` apne aap stamp hote hain.

{resource} list (18 products):
```
personal-loans        business-loans        home-loans
loan-against-properties   balance-transfers    project-loans
vehicle-loans         education-loans       credit-cards
working-capitals      commercial-purchases  lease-rental-discountings
od-cc-limits          loan-against-shares   npa-loans
gold-loans            fdi-loans             film-fundings
```

### I4. Customers
| GET | `/api/admin/customers` | `?search=&page=&limit=&isActive=true\|false` |
| GET | `/api/admin/customers/:id` | `{ success, customer }` |
| GET | `/api/admin/customers/:id/applications` | us customer ke saare loans |
| PATCH | `/api/admin/customers/:id/status` | active/inactive |
| DELETE | `/api/admin/customers/:id` | delete |

### I5. Franchises (applications + approval)
| GET | `/api/admin/franchises` | `?status=&search=&page=&limit=` |
| GET | `/api/admin/franchises/:id` | `{ success, credentials, loanCount, franchise }` — `credentials` me loginId + password (PAN) |
| PATCH | `/api/admin/franchises/:id/approve` | body khali — response me FRN code + password |
| PATCH | `/api/admin/franchises/:id/reject` | `{ note? }` |
| PATCH | `/api/admin/franchises/:id/reset-password` | password dobara PAN se hash |
| GET | `/api/admin/franchises/:id/loans` | is FRN ke loans |

### I6. Franchise plans (fee/validity manage)
| GET | `/api/admin/franchise-plans` | `?active=true\|false` — sab plans |
| POST | `/api/admin/franchise-plans` | naya plan |
| GET | `/api/admin/franchise-plans/:id` | ek plan |
| PATCH | `/api/admin/franchise-plans/:id` | fee/validity/renewal/features edit |
| PATCH | `/api/admin/franchise-plans/:id/best-value` | `{ isBestValue: true\|false }` |
| PATCH | `/api/admin/franchise-plans/:id/status` | `{ isActive: true\|false }` |
| DELETE | `/api/admin/franchise-plans/:id` | soft delete (deactivate) |

### I7. Franchise customers (read-only admin view)
| GET | `/api/admin/franchise-customers/stats` | network totals |
| GET | `/api/admin/franchise-customers` | list |
| GET | `/api/admin/franchise-customers/:id` | detail |

### I8. Masters (dropdown data) + Location
| GET/POST | `/api/admin/masters` | sab masters ki list / naya master |
| GET | `/api/admin/masters/banks` · POST · PUT · DELETE `/banks/:name` | bank list manage |
| GET/POST/PUT/DELETE | `/api/admin/masters/states`, `/states/:state/cities`, ... | states/cities/pincodes |
| GET/POST/PATCH/DELETE | `/api/admin/masters/location/...` | Location Master (continents/countries/states/cities/pincodes) |

---

# J. FRONTEND side — kaun sa page kaun sa URL call karta hai + data flow

**Frontend = customer site (loan forms + dashboard). Admin panel alag hai.**
(Base URL dono ka same: `http://localhost:5000` — frontend me sirf `/api/...` path jaata hai.)

### J1. Customer site (frontend) ka flow
```
1. User kisi bhi loan card par click
   → POST /api/auth/personal-loan     (ya /gold-loan, /credit-card … — 18 me se jo)
   → OTP screen khulta hai

2. User OTP daalta hai
   → POST /api/auth/verify-otp
   → response: { token, customerId, user } — token localStorage me save

3. Loan form render
   → GET /api/customer/loan-apply?product=personal&employmentType=Salaried
   → iske fields/limits se form banta hai

4. Form submit
   → POST /api/customer/loan-apply   (Bearer token + G-section body)
   → 201 + applicationNo (LOAN000001)

5. Dashboard
   → GET /api/customer/loans          (meri applications)
   → GET /api/customer/summary        (totals + counts)
   → GET /api/customer/loans/LOAN000001   (ek application ka status)
   → GET /api/customer/loan-status?panNumber=...   (PAN tracking)

6. "Track without login" page (agar ho)
   → same /api/customer/loan-status — par uske liye bhi token chahiye
     (customer ka, verify-otp ke baad)
```

### J2. Franchise site ka flow
```
1. /franchise page (PUBLIC)
   → GET  /api/franchise/plans          (plans + fees, bina token)
   → POST /api/franchise/entry          (details + planCode + business + OTP)
   → POST /api/franchise/entry/verify   (OTP → token, status Pending)

2. Franchise dashboard (franchiseToken)
   → GET /api/franchise/status          (Pending/Approved)
   → GET /api/franchise/profile
   → GET /api/franchise/loans           (sirf Approved)

3. Franchise apne customer ka loan
   → POST /api/franchise/customer/register        (customer details + OTP uske phone)
   → POST /api/franchise/customer/verify-otp      (franchiseCustomerId + otp → CUST id)
   → POST /api/franchise/customer/personal/applyloan  (product URL me)
   → GET  /api/franchise/customer                 (list, search)
   → GET  /api/franchise/customer/:id/loans       (tracking)
```

### J3. Admin panel ka flow
```
1. Login page
   → POST /api/admin/auth/login        (adminToken)

2. Dashboard
   → GET /api/admin/dashboard/stats

3. Loans pages (har product)
   → GET    /api/admin/personal-loans            (list)
   → PATCH  /api/admin/personal-loans/:id/status (Approve/Reject)

4. Franchise pages
   → GET    /api/admin/franchises                 (pending applications)
   → PATCH  /api/admin/franchises/:id/approve     (FRN + password mint)
   → GET    /api/admin/franchise-plans            (fee management)
   → PATCH  /api/admin/franchise-plans/:id        (fee edit)

5. Masters pages (dropdown data jo forms me dikhta hai)
   → GET /api/admin/masters, /api/admin/masters/banks, /api/admin/masters/location/...
```

### J4. Data flow — paisa/kidhar se kidhar jaata hai (customer loan)
```
POST /api/auth/:product        → OTP collection me pending details (koi user nahi banta)
POST /api/auth/verify-otp      → users collection me account + CUST id + JWT
GET  /api/customer/loan-apply  → (DB se nahi — LOAN_PRODUCTS config se aata hai form ka structure)
POST /api/customer/loan-apply  → <product> collection me application (LOAN000001, status Submitted)
PATCH /api/admin/{resource}/:id/status → admin decision + trail stamp
GET  /api/customer/loans/:no   → customer ko wahi decision dikhta hai
```

---

**Bas — itna hi poora system hai.** G-section se body copy karke Postman me daalo,
H-section se GET responses match karo, I-section se admin panel ki har call chalao,
J-section se samajh lo ki frontend har button par kya bhejta hai.
