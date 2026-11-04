# Franchise Customer Flow — API Reference (Frontend)

Approved franchise apne walk-in customer ko register karti hai aur usi customer
ke naam par loan apply karti hai.

Base URL: `http://localhost:5000`
Auth header: `Authorization: Bearer <FRANCHISE_TOKEN>`
(Franchise token `POST /api/franchise/login` se milta hai, aur franchise
`Approved` honi chahiye — warna `403`.)

---

## Flow

```
Franchise login
  → POST /api/franchise/customer/register              → customer save + customer ke phone par OTP
  → POST /api/franchise/customer/verify-otp            → mobile + OTP → CUST id (yahin users account banta hai)
  → POST /api/franchise/customer/:product/applyloan    → temporary loan-form draft
  → POST /api/franchise/customer/:id/credit-score      → 600+ score par LOAN000001 submit
  → GET  /api/franchise/customer/:id/draft            → pending form resume
  → DELETE /api/franchise/customer/:id/draft          → pending form cancel
  → GET  /api/franchise/customer/:id/loans             → status/timeline
```

Do gates yaad rakho:

| Gate | Kya chahiye |
|---|---|
| Verification gate | customer ka mobile OTP verify (`isVerified: true`), warna apply `403` |
| Credit gate | loan form draft ke baad score submit; `>= 600` par application submit hoti hai |

Verified customer ke agle loan par OTP dobara nahi lagta. Franchise login token
se customer select karke pending draft resume karein, ya pending draft na ho to
seedha naya loan form start karein. Ek customer ka ek hi unfinished draft rahega;
form submit ke 24 ghante baad draft expire hoga. Expiry ke baad verified customer
seedha naya form bhar sakta hai; OTP dobara nahi chahiye.

---

## 1. Register customer — `POST /api/franchise/customer/register`

```json
{
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "panNumber": "ABCDE1234F",
  "dob": "1995-05-15",
  "email": "rahul@example.com",
  "state": "Maharashtra",
  "city": "Pune",
  "pincode": "411001"
}
```

| Field | Required | Rule |
|---|---|---|
| `fullName` | ✅ | non-empty |
| `mobile` | ✅ | 10 digits (0 se shuru nahi) |
| `panNumber` | ✅ | `ABCDE1234F` format (auto-uppercase) |
| `dob` | ✅ | `YYYY-MM-DD`, applicant **18–65 years** |
| `email` | ✅ | valid email — verify par isi se `users` account + CUST id banti hai |
| `state` / `city` | ❌ | text |
| `pincode` | ❌ | 6 digits |

Response — **201**:

```json
{
  "success": true,
  "message": "Customer saved. An OTP has been sent to the customer's mobile (9876543210) for verification.",
  "nextStep": "verify-otp",
  "data": {
    "_id": "68f1c2…",
    "franchise": "…",
    "franchiseCode": "FRN000001",
    "fullName": "Rahul Sharma",
    "mobile": "9876543210",
    "panNumber": "ABCDE1234F",
    "dob": "1995-05-15T00:00:00.000Z",
    "email": "rahul@example.com",
    "isVerified": false
  }
}
```

`data._id` hi aage `franchiseCustomerId` banega. Account abhi nahi banta —
OTP verify hone par banta hai.

Errors: duplicate mobile in the same franchise → `409`; franchise ka apna mobile
→ `400`; invalid PAN/mobile/dob/email → `400`.

### OTP dobara bhejna — `POST /api/franchise/customer/resend-otp`

```json
{ "franchiseCustomerId": "68f1c2…" }
```

Sirf unverified customer ke liye; verified par `409`.

---

## 2. Verify customer OTP — `POST /api/franchise/customer/verify-otp`

Body me **customer ka mobile + OTP** jaata hai (`franchiseCustomerId` nahi):

```json
{
  "mobile": "9876543210",
  "otp": "123456"
}
```

`200` →

```json
{
  "success": true,
  "message": "Customer mobile verified successfully.",
  "customer": { "_id": "68f1c2…", "fullName": "Rahul Sharma", "mobile": "9876543210", "isVerified": true, "verifiedAt": "…" },
  "customerId": "CUST000045",
  "nextStep": "loan-apply"
}
```

Yahin customer ka `users` account + `CUST000045` banti hai (customer token
franchise ko nahi diya jaata). Already verified → `409`; OTP sirf usi franchise
ke usi customer ka chalta hai, warna `400`.

---

## 3. Apply loan form — `POST /api/franchise/customer/:product/applyloan`

Same customer cannot apply again for the same product within 3 days of a
recent application, including an application submitted directly or through a
franchise. A blocked request returns `409` with the remaining wait time.

OTP verify hone ke baad product ka form submit karein. Is step par loan abhi
create nahi hota; response se `draft.draftId` save karein.

```http
POST /api/franchise/customer/personal/applyloan
```

Request (personal loan, salaried):

```json
{
  "franchiseCustomerId": "68f1c2…",
  "product": "personal",
  "fullName": "Rahul Sharma",
  "mobile": "9876543210",
  "loanAmount": 300000,
  "loanTenure": 2,
  "employmentType": "Salaried",
  "companyName": "XYZ Ltd",
  "companyType": "Private Limited",
  "monthlySalary": 40000,
  "salaryReceivedAs": "Bank Transfer",
  "salaryBankName": "ICICI"
}
```

> Applicant ke personal details (fullName, mobile, PAN, DOB, email) **franchise
> customer ke profile se** aate hain — value profile se hi over-write hoti hai.
> `status` bhejna mana hai (`400`).

Response — **202**:

```json
{
  "success": true,
  "message": "Loan form saved temporarily. Submit the customer's credit score to complete the application.",
  "product": "personal",
  "nextStep": "credit-score",
  "franchiseCustomerId": "68f1c2…",
  "draft": {
    "draftId": "<UUID>",
    "product": "personal",
    "createdAt": "…",
    "expiresAt": "…"
  }
}
```

Product ke accepted forms: config key (`personal`, `goldLoan`, `lap`), key +
`loan` (`personalloan`), kebab-case (`personal-loan`) aur human name
(`loan-against-property`, `od-cc-limit`). Unknown product → `400`.

### Credit score — `POST /api/franchise/customer/:id/credit-score`

`:id` = `franchiseCustomerId`. `draftId`, jo apply response mein mila, aur score
submit karein:

```json
{ "draftId": "<UUID>", "creditScore": 720 }
```

Score `300`–`900` integer hota hai; `>= 600` eligible. Eligible score par
application submit hoti hai aur 24-hour eligibility window shuru hoti hai.
Score `< 600` par application create nahi hoti aur draft retry ke liye retained
rehta hai, lekin draft sirf form submit hone ke baad 24 ghante tak valid hai.

Eligible response mein `nextStep: "complete"` aur `application` milega. Errors:
draft missing/24 ghante se purana → `409`; customer OTP unverified → `403`;
invalid score → `400`. Expired draft ke baad customer ke liye OTP verify dobara
nahi karna; fresh form submit karke naya `draftId` lein.

### Pending draft ko resume/cancel karna

Customer ko franchise list/detail se select karne ke baad:

```http
GET {{BASE_URL}}/api/franchise/customer/{{franchiseCustomerId}}/draft
```

Pending draft ho to response mein `nextStep: "credit-score"` aur saved form
`draft.data` mein milega. Wahi `draft.draftId` credit-score endpoint ko bhejkar
application complete karein. Response ka `expiresAt` batata hai kitni der tak
draft valid rahega. Draft absent ya expire ho to `hasPendingDraft: false` aur
`nextStep: "loan-apply"` milega; customer verified rahega, OTP repeat nahi hoga.

Naya product start karne se pehle existing draft complete karein ya cancel karein:

```http
DELETE {{BASE_URL}}/api/franchise/customer/{{franchiseCustomerId}}/draft
```

Cancel karne ke baad customer verified hi rahega; agle loan ke liye OTP dobara
nahi chahiye.

---

## 5. Read / track

| Method | Path | Kya deta hai |
|---|---|---|
| `GET` | `/api/franchise/customer?search=&page=&limit=` | apne customers (+ har customer ka loan count, `total`/`page`/`totalPages`) |
| `GET` | `/api/franchise/customer/:id` | ek customer ki poori detail |
| `PATCH` | `/api/franchise/customer/:id` | details update |
| `GET` | `/api/franchise/customer/:id/loans` | product-wise grouped loans + `byStatus` |
| `GET` | `/api/franchise/customer/:id/loans/:applicationNo` | ek loan ka status/stage/timeline |

Har query franchise-scoped hai — doosri franchise ka customer `404` deta hai.

## 6. Franchise ki apni book

| Method | Path | Kya deta hai |
|---|---|---|
| `GET` | `/api/franchise/loans` | is FRN se fil hui saari applications, product-wise grouped |
| `GET` | `/api/franchise/profile` | registration data + status |
| `GET` | `/api/franchise/status` | approval status (Pending / Approved / Rejected + reason) |
