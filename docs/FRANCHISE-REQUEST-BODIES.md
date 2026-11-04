# Franchise — Postman ke liye ready request bodies

Base URL: `http://localhost:5000` (ya `PORT` jo `.env` me hai).
Sab JSON bodies neeche **copy-paste ready** hain, aur jo values maine live chala kar
dekhi hain wahi daali hain.

Postman me ye environment variables bana lo (chain isse chalti hai):

| Variable | Kahan se milega |
|----------|-----------------|
| `baseUrl` | `http://localhost:5000` |
| `franchiseToken` | `POST /api/franchise/entry/verify` ya `POST /api/franchise/login` ka `token` |
| `adminToken` | `POST /api/admin/auth/login` ka `token` |
| `franchiseId` | `PATCH /api/admin/franchises/:id/approve` ka `credentials.loginId` (FRN000010) |
| `franchiseCustomerId` | `POST /api/franchise/customer/register` ka `data._id` |
| `applicationNo` | `POST /api/franchise/customer/:product/applyloan` ka `data.applicationNo` (LOAN000049) |

Header dono jagah same: `Content-Type: application/json` + (jahan token chahiye) `Authorization: Bearer {{franchiseToken}}`.

---

## 0. Plans dekho (public — body nahi)

```http
GET {{baseUrl}}/api/franchise/plans
```
Response se `code` uthao — wahi `planCode` entry me jaayega (`3Y`, `1Y`, `6M`, `3M`, `1M`).

---

## 1. `POST /api/franchise/entry` (public — koi token nahi)

Saare fields ek hi call me jaate hain: identity + plan + business details.
**Account yahan nahi banta** — OTP ke baad banta hai.

```json
{
  "name": "Naya Franchise Partner",
  "email": "partner.franchise@example.com",
  "mobile": "9876500001",
  "dob": "1990-04-11",
  "panNumber": "ABCDE1234F",
  "continent": "Asia",
  "country": "India",
  "pincode": "110001",
  "state": "Delhi",
  "city": "New Delhi",

  "planCode": "3Y",

  "businessName": "Naya Enterprises Pvt Ltd",
  "businessType": "Private Limited",
  "gstNumber": "27ABCDE1234F1Z5",
  "address": "12 Test Road, Andheri",
  "yearsInBusiness": "4"
}
```

| Field | Zaroori? | Rule |
|-------|----------|------|
| `name` | ✅ | khaali nahi |
| `email` | ✅ | valid email (normalize ho jaata hai) |
| `mobile` | ✅ | 10 digit |
| `dob` | ✅ | `YYYY-MM-DD`, ISO |
| `panNumber` | ✅ | `^[A-Z]{5}[0-9]{4}[A-Z]$` (uppercase ho jaata hai) |
| `continent`, `country`, `state`, `city` | ✅ | current location; non-empty text |
| `pincode` | ✅ | exactly 6 digits |
| `planCode` | ✅ (ya `package`) | `GET /api/franchise/plans` ka active code |
| `package` | purana option | free-text; `planCode` na bhejo to kam se kam ye |
| `businessName`, `businessType`, `gstNumber`, `address`, `yearsInBusiness` | optional | `businessDetails` me save hote hain |

`200` →
```json
{ "success": true, "message": "OTP sent to 98******01", "mobileMasked": "98******01", "nextStep": "verify-otp" }
```
Errors: plan galat/deactivated → `400`; mobile/email already registered → `400`; bahut zyada calls → `429`.

---

## 2. `POST /api/franchise/entry/verify` (public)

```json
{
  "mobile": "9876500001",
  "otp": "123456"
}
```
Dev OTP: `SMS_PROVIDER=console` → server log me OTP print hota hai, ya `.env` ka `STATIC_OTP=123456`.

`200` →
```json
{
  "success": true, "message": "Mobile verified successfully",
  "token": "<franchise JWT -> {{franchiseToken}}>",
  "idType": "franchise",
  "nextStep": "franchise-pending",
  "franchiseStatus": "Pending",
  "franchiseId": null,
  "package": "3-Year-Plan",
  "plan": { "code": "3Y", "name": "3-Year-Plan", "fee": 249000, "totalWithGst": 293820 },
  "user": { "_id": "…", "name": "…", "mobile": "9876500001", "isVerified": true, "franchiseStatus": "Pending", "franchiseId": null }
}
```

---

## 3. Admin: application dekho + approve

```http
GET   {{baseUrl}}/api/admin/franchises?status=Pending&search=9876500001     (admin token)
GET   {{baseUrl}}/api/admin/franchises/{{franchiseDocId}}                   (admin token)
PATCH {{baseUrl}}/api/admin/franchises/{{franchiseDocId}}/approve            (admin token, body nahi)
```

`approve` ke baad response me hi login detail aata hai — yahi partner ko bhejna hai:

```json
{
  "success": true,
  "message": "Franchise approved. Login ID: FRN000010",
  "credentials": { "loginId": "FRN000010", "password": "ABCDE1234F", "passwordIsPan": true },
  "franchise": { "franchiseId": "FRN000010", "franchiseStatus": "Approved", "franchiseApprovedAt": "…" }
}
```
⚠️ `password` = franchise ka **PAN number** (bcrypt hash me store hota hai, sirf yahan plain dikhta hai).

---

## 4. `POST /api/franchise/login` (public)

```json
{
  "franchiseId": "FRN000010",
  "password": "ABCDE1234F"
}
```
`200` → `{ success: true, message: "Login successful", token, franchise: { … } }`
Galat credentials / Pending franchise → `401`; 10 se zyada try → `429`.

---

## 5. `POST /api/franchise/customer/register` (franchise token — Approved hona zaroori)

```json
{
  "fullName": "Flow Finish Customer",
  "mobile": "8366421456",
  "panNumber": "PQRSX6789K",
  "dob": "1991-03-05",
  "email": "flowcust.finish@example.com",
  "state": "Maharashtra",
  "city": "Pune",
  "pincode": "411001"
}
```

| Field | Zaroori? | Rule |
|-------|----------|------|
| `fullName` | ✅ | khaali nahi |
| `mobile` | ✅ | 10 digit — **customer ke naam par loan ka owner account isi se link hota hai** |
| `panNumber` | ✅ | PAN pattern (uppercase) |
| `dob` | ✅ | `YYYY-MM-DD`, **21 saal se bada** |
| `email` | ✅ | valid email (OTP verify hone par isi se `users` account + CUST id banti hai) |
| `state`, `city`, `pincode` | optional | pincode `^\d{6}$` |

`201` →
```json
{
  "success": true,
  "message": "Customer saved. An OTP has been sent to the customer's mobile (8366421456) for verification.",
  "nextStep": "verify-otp",
  "data": { "_id": "6ad0…  -> {{franchiseCustomerId}}", "fullName": "Flow Finish Customer",
            "mobile": "8366421456", "panNumber": "PQRSX6789K",
            "franchise": "…", "franchiseCode": "FRN000010", "isVerified": false }
}
```
Errors: wahi mobile dobara → `409`; franchise ka apna mobile → `400`; Pending franchise → `403`.

### OTP dobara bhejna (agar pehla OTP nahi mila ya pehle wala record nahi raha)

**POST** `{{baseUrl}}/api/franchise/customer/resend-otp` (franchise token)

```json
{
  "franchiseCustomerId": "{{franchiseCustomerId}}"
}
```

Naya OTP customer ke registered mobile par bheja jaata hai. Response me `mobileMasked`
aur `nextStep: "verify-otp"` milta hai. Iske baad section 6 wala `/verify-otp` request
latest OTP ke saath bhejein. OTP ka time-based expiry nahi hai.

---

## 6. `POST /api/franchise/customer/verify-otp` (franchise token)

Body me **customer ka mobile** jaata hai (`franchiseCustomerId` nahi):

```json
{
  "mobile": "8366421456",
  "otp": "123456"
}
```
`200` →
```json
{
  "success": true, "message": "Customer mobile verified successfully.",
  "customer": { "_id": "…", "fullName": "Flow Finish Customer", "mobile": "8366421456", "isVerified": true, "verifiedAt": "…" },
  "customerId": "CUST000045",
  "nextStep": "loan-apply"
}
```
Pehle se verified → `409`. Iske bina loan apply `403` deta hai.

---

## 6b. `POST /api/franchise/customer/:product/applyloan` (franchise token)

OTP verify ke baad loan form submit karein. Isse temporary draft banta hai; response
ka `draft.draftId` agle credit-score request me bhejna hai.

```http
POST {{baseUrl}}/api/franchise/customer/personal/applyloan
```

Product URL me aata hai: `/personal/applyloan`, `/business/applyloan`,
`/gold-loan/applyloan`, `/credit-card/applyloan` etc.

### 7a. Personal loan (live verified body)

```json
{
  "franchiseCustomerId": "{{franchiseCustomerId}}",
  "product": "personal",

  "fullName": "Flow Finish Customer",
  "mobile": "8366421456",

  "loanAmount": 450000,
  "loanTenure": 3,
  "employmentType": "Salaried",
  "companyName": "ABC Corp",
  "companyType": "Private Limited",
  "monthlySalary": 60000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "HDFC"
}
```

### 7b. Business loan (tumhara hi business payload, franchise ke liye)

```json
{
  "franchiseCustomerId": "{{franchiseCustomerId}}",
  "product": "business",

  "fullName": "Naya Customer Business",
  "mobile": "9876543220",

  "loanAmount": 2500000,
  "loanTenure": 5,
  "employmentType": "Self Employed - Business",
  "businessType": "Private Limited",
  "businessName": "Naya Traders Pvt Ltd",
  "gstNumber": "27NEWCU1234B1Z5",
  "companyPanNumber": "NEWCU1234B",
  "natureOfBusiness": "Trading",
  "industryType": "Retail",
  "subIndustry": "FMCG Distribution",
  "businessEstablishedDate": "2015-06-01",
  "transactionBankName": "HDFC Bank",
  "lastYearTurnover": 5000000,
  "last2YearsTurnover": 4200000,
  "lastYearNetIncome": 800000,
  "last2YearsNetIncome": 650000,
  "businessState": "Maharashtra",
  "businessCity": "Mumbai",
  "businessPincode": "400001",
  "businessPlaceStatus": "Owned",

  "existingEMI": 12000,
  "existingLoanAmount": 500000,
  "existingBanks": ["HDFC Bank", "ICICI Bank"],
  "existingLoanTypes": ["Home Loan", "Car Loan"],
  "otherBankList": ["Naya Bank"],
  "otherLoanList": ["Gold Loan"],

  "state": "Maharashtra",
  "city": "Mumbai",
  "pincode": "400001",
  "residenceStatus": "Owned"
}
```

`202` →
```json
{
  "success": true,
  "product": "personal",
  "nextStep": "credit-score",
  "franchiseCustomerId": "6ad0…",
  "draft": { "draftId": "<UUID>", "createdAt": "…", "expiresAt": "…" }
}
```

### Body ke rules (zaroori)

1. `franchiseCustomerId` **mandatory** — `400 "franchiseCustomerId is required…"`.
2. **`fullName` aur `mobile` profile se server bhar deta hai** — request me bhejne ki zaroorat nahi.
3. Baaki personal fields (email, dob, PAN, state, city, pincode) optional hain — jo form na bheje wo
   franchise customer ke profile se bharte hain. Residence/business addresses profile se override hote hain.
4. `status` bhejna mana hai: `400 "status cannot be set by the applicant"`.
5. Product ke fields hi chahiye (business ke liye `businessName`, gold ke liye collateral fields, etc.).
   Exact field list kisi bhi product ke liye dekhne ka tareeka (customer token se):
   `GET {{baseUrl}}/api/customer/loan-apply?product=<product>` → usme `fields` section-wise field names deta hai.
   (Franchise ke liye aisa koi form-config endpoint abhi nahi hai.)
6. **Credit gate**: loan form draft ke baad score submit hota hai; `draftId` required hai.
   Score `>= 600` par application submit hoti hai; score `< 600` par draft retry ke liye retained rahega.

Response `202`: `{ "success": true, "product": "personal", "nextStep": "credit-score",
"draft": { "draftId": "<UUID>", "product": "personal", "createdAt": "…" } }`.

## 7b. `POST /api/franchise/customer/:id/credit-score` (franchise token)

`:id` = `{{franchiseCustomerId}}`. Loan apply response ka `draftId` aur customer score bhejein:

```json
{ "draftId": "<UUID>", "creditScore": 720 }
```

- `300`–`900` integer; `>= 600` par actual application submit hoti hai.
- Score `< 600` par draft retained rehta hai, lekin loan form submit ke 24 ghante baad expire hota hai.
- Eligible response me `nextStep: "complete"` aur `application` milte hain.

Ek customer ke liye ek hi pending draft hota hai. Wapas aane par ise franchise
token se resume karein; customer ka OTP dobara nahi chahiye:

```http
GET {{baseUrl}}/api/franchise/customer/{{franchiseCustomerId}}/draft
```

Pending draft ho to response `nextStep: "credit-score"`, saved form data aur
`expiresAt` deta hai. Form submit ke 24 ghante ke andar score submit karein.
Expire hone par verified customer ko OTP dobara nahi chahiye; woh fresh form
fill karke naya draft bana sakta hai. Naya loan shuru karne se pehle active
pending draft complete karein ya cancel:

```http
DELETE {{baseUrl}}/api/franchise/customer/{{franchiseCustomerId}}/draft
```

---

## 8. Tracking (franchise token)

```http
GET {{baseUrl}}/api/franchise/loans
GET {{baseUrl}}/api/franchise/customer?search=8366&page=1&limit=10
GET {{baseUrl}}/api/franchise/customer/{{franchiseCustomerId}}
GET {{baseUrl}}/api/franchise/customer/{{franchiseCustomerId}}/loans
GET {{baseUrl}}/api/franchise/customer/{{franchiseCustomerId}}/loans/{{applicationNo}}
PATCH {{baseUrl}}/api/franchise/customer/{{franchiseCustomerId}}     {"city":"Mumbai"}
```

## 9. Admin decision (admin token)

```http
GET   {{baseUrl}}/api/admin/personal-loans
PATCH {{baseUrl}}/api/admin/personal-loans/{{loanDocId}}/status
```
```json
{ "status": "Approved", "note": "KYC verified" }
```
`status` allowed: `Pending` | `Approved` | `Rejected` (`Submitted` se hi badla ja sakta hai).

---

## Ek baar me poora chain (curl, Git Bash)

```bash
BASE=http://localhost:5000

# 1 plans
curl -s $BASE/api/franchise/plans

# 2 entry  (body upar se)
curl -s -X POST $BASE/api/franchise/entry -H "Content-Type: application/json" -d @entry.json

# 3 verify -> token nikaal lo
curl -s -X POST $BASE/api/franchise/entry/verify -H "Content-Type: application/json" \
  -d '{"mobile":"9876500001","otp":"123456"}'

# 4 admin login + approve
curl -s -X POST $BASE/api/admin/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@indexiafinance.com","password":"Admin@123"}'
curl -s -X PATCH $BASE/api/admin/franchises/<franchiseDocId>/approve -H "Authorization: Bearer <adminToken>"

# 5 franchise login
curl -s -X POST $BASE/api/franchise/login -H "Content-Type: application/json" \
  -d '{"franchiseId":"FRN000010","password":"ABCDE1234F"}'

# 6 customer register -> franchiseCustomerId
curl -s -X POST $BASE/api/franchise/customer/register -H "Authorization: Bearer <frToken>" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Flow Finish Customer","mobile":"8366421456","panNumber":"PQRSX6789K","dob":"1991-03-05","email":"flowcust.finish@example.com","state":"Maharashtra","city":"Pune","pincode":"411001"}'

# 7 customer OTP
curl -s -X POST $BASE/api/franchise/customer/verify-otp -H "Authorization: Bearer <frToken>" \
  -H "Content-Type: application/json" -d '{"mobile":"8366421456","otp":"123456"}'

# Purane score apply flow ko use na karein; pehle loan form submit karke draftId lein.
curl -s -X POST $BASE/api/franchise/customer/<fcId>/credit-score -H "Authorization: Bearer <frToken>" \
  -H "Content-Type: application/json" -d '{"creditScore":720}'

# 8 loan apply (personal)
curl -s -X POST $BASE/api/franchise/customer/personal/applyloan -H "Authorization: Bearer <frToken>" \
  -H "Content-Type: application/json" \
  -d '{"franchiseCustomerId":"<fcId>","product":"personal","fullName":"Flow Finish Customer","mobile":"8366421456","loanAmount":450000,"loanTenure":3,"employmentType":"Salaried","companyName":"ABC Corp","companyType":"Private Limited","monthlySalary":60000,"salaryReceivedAs":"Bank Transfer","salaryBankName":"HDFC"}'

# 9 credit score -> eligible par application submit hoti hai
curl -s -X POST $BASE/api/franchise/customer/<fcId>/credit-score -H "Authorization: ******" \
  -H "Content-Type: application/json" -d '{"draftId":"<draftId>","creditScore":720}'

# 10 dekho
curl -s $BASE/api/franchise/customer/<fcId>/loans -H "Authorization: Bearer <frToken>"
curl -s $BASE/api/franchise/loans -H "Authorization: Bearer <frToken>"
```

Poora flow + verified responses: `docs/FRANCHISE-END-TO-END-FLOW.md`.
