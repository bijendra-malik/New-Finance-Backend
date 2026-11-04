# Loan Entry API — OTP wala entry (register / login / apply hata diye gaye)

Base URL (dev): `http://localhost:5000`
Auth header: `Authorization: Bearer <TOKEN>`

> **Register / signup / customer-login nahi hai.** Account sirf mobile OTP verify
> hone par banta hai — usi waqt **CUST id** aur **token** milte hain.
> Franchise ka alag darwaza hai, aur uska "apply" step bhi ab entry me hi hai.

---

## 0. Poora flow ek nazar me

```
CUSTOMER
  Loan click -> POST /api/auth/<product>       details + OTP   (kuch save nahi)
            -> POST /api/auth/verify-otp       OTP -> account + CUST000001 + TOKEN
            -> GET  /api/customer/loan-apply?product=personal&employmentType=Salaried
                                               form ka config (kaunse field aate hain)
            -> POST /api/customer/loan-apply   TOKEN ke saath form -> 24h draft (per product)
            -> POST /api/customer/credit-score draftId + score -> eligible par LOAN000001

FRANCHISE
  Franchise banna -> POST /api/franchise/entry         details + PLAN + business + OTP
                  -> POST /api/franchise/entry/verify   OTP -> account + TOKEN
                                                        (franchiseStatus = Pending)
  Admin           -> PATCH /api/admin/franchises/:id/approve   -> FRN000001 + password
  Franchise login -> POST /api/franchise/login  (FRN + password) -> TOKEN

FRANCHISE KE APNE CUSTOMER KA LOAN (login ke baad)
  1. POST /api/franchise/customer/register      customer details -> uske MOBILE par OTP
  2. POST /api/franchise/customer/verify-otp    OTP -> customer ka account + CUST id
  3. POST /api/franchise/customer/:product/applyloan   form draft -> draftId
  4. POST /api/franchise/customer/:id/credit-score     draftId + score -> eligible par loan file
```

Yaad rakho:

- **Customer ka koi login nahi.** Uska token sirf us ek loan form ke liye hai.
- **Ek mobile par CUST aur FRN dono** ho sakte hain — ID ka prefix alag karta hai.
- Franchise ke customer ka **OTP uske apne mobile par** jaata hai; verify hone se
  pehle uske naam par loan file nahi hoga.

---

## 1. Customer entry — step 1 (details + OTP)

`product` **URL me** aata hai. `personal-loan`, `gold-loan`, `credit-card`,
`loan-against-property` jaise slugs chalte hain (saare 18 products).

```
POST /api/auth/personal-loan
POST /api/auth/home-loan
POST /api/auth/gold-loan
POST /api/auth/credit-card … (product URL me)
```

**Body** (public — koi token nahi). Sirf `continent` + `country` hain, state/city/pincode **nahi**:

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

Flat JSON body recommended hai. Client agar fields ko `data` ke andar bhejta hai
(`{ "data": { ... } }`), entry endpoint us shape ko bhi accept karta hai. Postman
me **Body → raw → JSON** aur `Content-Type: application/json` set karein.

**Response `200`:**

```json
{
  "success": true,
  "message": "OTP sent to 98******10",
  "mobileMasked": "98******10",
  "product": "personal",
  "loanType": "Personal Loan",
  "nextStep": "verify-otp"
}
```

Yahan **kuch bhi save nahi hota** — na account, na CUST id. Details OTP document me
**pending** rehti hain, isliye adhoora form chhodhne par kuch bachta nahi.

**Errors:** `400` — name khaali · mobile 10 digit ka nahi · email galat · DOB missing/galat ·
PAN format galat · age 18 se kam · unknown product.

---

## 2. Customer entry — step 2 (OTP verify → account + CUST id + token)

```
POST /api/auth/verify-otp
{ "mobile": "9876543210", "otp": "123456" }
```

**Response `200`:**

```json
{
  "success": true,
  "message": "Mobile verified successfully",
  "token": "<JWT>",
  "idType": "customer",
  "customerId": "CUST000001",
  "product": "personal",
  "loanType": "Personal Loan",
  "nextStep": "loan-apply",
  "user": {
    "_id": "68f…", "customerId": "CUST000001", "name": "Rahul Sharma",
    "mobile": "9876543210", "email": "rahul@example.com",
    "dob": "1995-05-15", "panNumber": "ABCDE1234F",
    "continent": "Asia", "country": "India", "role": "Customer",
    "isVerified": true, "isActive": true
  }
}
```

Isi waqt account banta hai (ya purana wala hi rehta hai), **CUST id** mint hoti hai,
aur **token** milta hai.
**OTP ki koi expiry nahi hai** (jaan-boojh kar — lambi testing me bhi chalta rahe).
OTP doc mobile ke saath pada rehta hai jab tak naya entry usi mobile ka OTP replace
na kar de, aur wahi OTP jitni baar chaho verify kiya ja sakta hai: repeat request wahi
account response/token degi, bina account/franchise side-effects dobara chalaye.
Naya OTP request purane OTP ko replace kar dega.

**Token me entry ka product bhi hota hai** (`"product": "personal"` claim) — uske
baad apply sirf USI product ka chalta hai. Doosre product ke liye uski apni entry
karni padegi (dekho section 4).

**Errors:** `400 OTP Not Found` · `400 Invalid OTP` ·
`400 This OTP was sent for a different entry. Please start again.` · `409` duplicate email.

---

## 3. Loan form ka config (GET) — verify ke baad

```
GET /api/customer/loan-apply?product=personal&employmentType=Salaried
Authorization: Bearer <TOKEN>
```

Prodh ka poora "kaunse field aate hain + kya limits hain" yahin se milta hai:

```json
{
  "success": true,
  "product": "personal",
  "loanType": "Personal Loan",
  "route": "/api/personal-loan",
  "employmentTypes": ["Salaried"],
  "employmentTypeRequired": false,
  "employmentTypeDefault": "Salaried",
  "income": "salaried",
  "loanAmountRequired": true, "loanAmountMin": 100000,
  "loanTenureRequired": true,
  "personalDetailsRequired": false,
  "exposureRequired": false,
  "multiValueFields": [],
  "sections": {
    "loanBasics": ["loanAmount", "loanTenure"],
    "loanRequirements": null,
    "income": ["monthlySalary", "salaryReceivedAs", "salaryBankName"],
    "existingLoanExposure": ["…"],
    "personalDetails": ["…"]
  },
  "submitTo": "POST /api/customer/loan-apply"
}
```
`loanTenure` is entered in years and accepts any whole-number value; the API
does not enforce product-specific minimum or maximum tenure limits.

## 4. Loan form draft (POST)

```
POST /api/customer/loan-apply      Authorization: Bearer <TOKEN>
{
  "product": "personal",
  "loanAmount": 500000, "loanTenure": 3,
  "employmentType": "Salaried",
  "companyName": "ABC Corp", "companyType": "Private Limited",
  "monthlySalary": 50000, "salaryReceivedAs": "Bank Transfer", "salaryBankName": "HDFC"
}
→ 202 { "success": true, "product": "personal", "nextStep": "credit-score",
        "draft": { "draftId": "…", "expiresAt": "…" } }
```

Form temporary draft ke roop me 24 ghante tak rakha jaata hai; is request par final
loan application create nahi hoti. `draftId` response se lekar credit-score request
mein bhejein:

```
POST /api/customer/credit-score      Authorization: ******
{ "draftId": "…", "creditScore": 720 }
```

Score `300–900` integer hona chahiye. Score `600+` ho to draft final loan application
ke roop me save hota hai, response mein application details milti hain aur 24-hour
eligibility window shuru hoti hai. `300–599` par application create nahi hoti; draft
24 ghante tak rehta hai aur customer dobara score submit kar sakta hai. Expired draft
ke liye loan form dobara submit karna hoga.

**Ek token = ek product.** Token jis loan product ki entry (OTP) se bana tha, apply
sirf usi product ka chalega. Product badal kar bhejne par saaf `403`:

```json
{ "success": false,
  "message": "Your token was issued for Personal Loan. To apply for Home Loan, please complete the Home Loan entry (verify your mobile with the OTP) and use that token.",
  "entryProduct": "personal",
  "requestedProduct": "home" }
```

Doosre product ke liye uski apni entry karni padegi: `POST /api/auth/<product>` →
OTP verify → **naya token**, phir apply. Rule dono doors par lagta hai — unified
`/api/customer/loan-apply` aur per-product `POST /api/<product>/apply`.
(`modules/auth/entryProduct.js` + `middleware/entryProduct.middleware.js`.)

Franchise doors (`/api/franchise/customer/:product/applyloan`) par ye rule nahi
lagta — unka product URL se aata hai aur franchise token me product hota hi nahi.
`GET /api/customer/loan-apply?product=…` (form ka config) bhi khula rehta hai; rok
sirf submit par hai.

---

## 5. Franchise entry — step 1 (details + PLAN + business + OTP)

Ye ek hi form hai: basic details + **kaunsa plan** + business ka data.

```
POST /api/franchise/entry
{
  "name": "Amit Verma",
  "email": "amit@example.com",
  "mobile": "9876543222",
  "dob": "1990-01-20",
  "panNumber": "ABCDE1234F",
  "continent": "Asia",
  "country": "India",

  "planCode": "3Y",
  "businessName": "Amit Enterprises",
  "businessType": "Proprietorship",
  "gstNumber": "09ABCDE1234F1Z5",
  "address": "Sector 62, Noida",
  "yearsInBusiness": "3"
}
→ 200 { "success": true, "message": "OTP sent to 98******22",
        "mobileMasked": "98******22", "nextStep": "verify-otp" }
```

- Plan **`planCode`** se aata hai (published plans: `GET /api/franchise/plans`).
  Purana free-text **`package`** bhi chalta hai.
- Plan entry par hi check ho jaata hai — galat/deactivate plan par OTP bhi nahi jaata.
- `businessName`, `businessType`, `gstNumber`, `address`, `yearsInBusiness` optional hain.

## 6. Franchise entry — step 2 (OTP verify → Pending)

```
POST /api/franchise/entry/verify
{ "mobile": "9876543222", "otp": "123456" }
```

**Response `200`:**

```json
{
  "success": true,
  "message": "Mobile verified successfully",
  "token": "<JWT>",
  "idType": "franchise",
  "nextStep": "franchise-pending",
  "franchiseStatus": "Pending",
  "franchiseId": null,
  "package": "3 Years",
  "plan": { "code": "3Y", "name": "3 Years", "fee": 210000, "totalWithGst": 247800 },
  "user": {
    "_id": "68f…", "name": "Amit Verma", "mobile": "9876543222",
    "email": "amit@example.com", "dob": "1990-01-20", "panNumber": "ABCDE1234F",
    "continent": "Asia", "country": "India",
    "franchiseStatus": "Pending", "franchiseId": null, "isVerified": true
  }
}
```

Verify hote hi plan ka **snapshot** franchise par utar jaata hai aur
**franchiseStatus = Pending** ho jaata hai — alag se koi `apply` step nahi hai.
**Password kabhi response me nahi aata.**

---

## 7. Status dekhna (pending / approved / rejected)

```
GET /api/franchise/status        Authorization: Bearer <FRANCHISE TOKEN>
```

Rejected hone par **admin ne jo reason diya wahi** dikhta hai:

```json
{
  "success": true,
  "franchiseStatus": "Rejected",
  "canLogin": false,
  "rejectionReason": "PAN and business name do not match",
  "rejectedAt": "2026-10-14T09:12:00.000Z",
  "message": "Your franchise application was rejected. Reason: PAN and business name do not match"
}
```

Approved hone par **na ID na password** — bas login ka message:

```json
{
  "success": true,
  "franchiseStatus": "Approved",
  "canLogin": true,
  "approvedAt": "2026-10-14T09:20:00.000Z",
  "message": "Your franchise is approved. Please login with the franchise ID and password shared by the admin."
}
```

Admin reject karte waqt note deta hai: `PATCH /api/admin/franchises/:id/reject` → `{ "note": "…" }`.

## 8. Admin approve → franchise login

```
PATCH /api/admin/franchises/:id/approve     (admin token)
→ { "success": true, "credentials": { "loginId": "FRN000001", "password": "ABCDE1234F" }, ... }

POST /api/franchise/login                   (public)
{ "franchiseId": "FRN000001", "password": "ABCDE1234F" }
→ { "success": true, "token": "<FRANCHISE JWT>", "franchise": { ... } }
```

Approval se pehle dashboard aur loan routes `403` dete hain (`requireApprovedFranchise`).

---

## 9. Franchise apne customer ka loan (3 step, login ke baad)

```
POST /api/franchise/customer/register          (franchise token)
{
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "panNumber": "ABCDE1234F",
  "dob": "1995-05-15",
  "email": "rahul@example.com",
  "state": "Punjab", "city": "Ludhiana", "pincode": "141001"
}
→ 201 { "success": true,
        "message": "Customer saved. An OTP has been sent to the customer's mobile (9876543210) for verification.",
        "nextStep": "verify-otp",
        "data": { "_id": "<FRANCHISE_CUSTOMER_ID>", "fullName": "Rahul Sharma", "isVerified": false, ... } }
```

> `email` ab **zaroori** hai — verify hone par isi se customer ka loan account
> (aur CUST id) banta hai.

```
POST /api/franchise/customer/verify-otp        (franchise token)
{ "franchiseCustomerId": "<FRANCHISE_CUSTOMER_ID>", "otp": "123456" }
→ { "success": true, "message": "Customer mobile verified successfully.",
    "customerId": "CUST000002", "nextStep": "loan-apply",
    "customer": { "_id": "…", "isVerified": true, "verifiedAt": "…" } }
```

Yahin customer ka `users` account + **CUST id** banti hai. Customer ka token franchise
ko **nahi** diya jaata — uske paas apni franchise token already hai.

```
POST /api/franchise/customer/personal/applyloan      (franchise token)
{
  "franchiseCustomerId": "<FRANCHISE_CUSTOMER_ID>",
  "loanAmount": 300000, "loanTenure": 2,
  "employmentType": "Salaried",
  "companyName": "XYZ Ltd", "companyType": "Private Limited",
  "monthlySalary": 40000, "salaryReceivedAs": "Bank Transfer", "salaryBankName": "ICICI"
}
→ 201 { "success": true, "product": "personal", "franchiseId": "FRN000001",
        "customerId": "<CUST ka _id>", "franchiseCustomerId": "<FRANCHISE_CUSTOMER_ID>",
        "data": { "applicationNo": "LOAN000002", ... } }
```

**Customer verify nahi hai to `403`:** "This customer's mobile is not verified yet.
Send the OTP and verify the customer before applying for a loan."

---

## 10. Hata diye gaye endpoints

| Endpoint | Status |
|---|---|
| `POST /api/auth/register` | **hata diya** — ab `/api/auth/:product` ya `/api/franchise/entry` |
| `POST /api/auth/login/request-otp` | customer login OTP request |
| `POST /api/auth/login/:product/verify-otp` | `{ mobile, otp }` se login verify; product URL se aata hai |
| `POST /api/customer/apply-register` | **hata diya** — dob/PAN ab entry form me hi aate hain |
| `POST /api/franchise/apply` | **hata diya** — plan + business ab `/api/franchise/entry` me hi |
| `POST /api/auth/verify-otp` | **rakha hai, kaam badla** — account + CUST id + token banata hai |
| `POST /api/franchise/login` | jaise tha waisa (FRN + password) |

---

## 11. Testing ke liye chhoti baatein

- **OTP dev me server log me** print hota hai ([sendOTP.js](../src/utils/sendOTP.js)),
  ya `.env` me `STATIC_OTP=123456` set kar do to fix ho jaata hai.
- Verify route par **10 attempts / 10 min per IP** ka limit hai — fast testing me `429` aa sakta hai.
- **Status door (bina token)**: `POST /api/customer/status/request-otp` (CUST id + PAN + registered
  mobile -> us mobile par OTP) aur `POST /api/customer/status` (mobile + OTP -> application ka status,
  stage, timeline aur admin ka note). Status ka OTP apne `purpose: "status"` me rehta hai,
  isliye wo entry ke pending OTP ko replace nahi karta (aur ulta bhi nahi).
