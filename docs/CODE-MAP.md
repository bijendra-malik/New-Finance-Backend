# Code Map — kaunsi file kiski hai, kya update hua, kya delete hua

Ye doc batata hai ki poora entry/loan system kis file me hai, har layer ka kaam kya hai,
aur is baar exactly kya badla.

---

## 1. Har file kiski hai (module map)

### Entry engine (sabse pehle ye padho) — teeno role isi ko use karte hain
| File | Kaam |
|---|---|
| [entry.service.js](../src/modules/auth/entry.service.js) | **Naya, dil (engine) hai.** `startEntry()` = details pending me rakho + OTP bhejo. `verifyEntry()` = OTP match par account banao, **CUST id** mint karo, token do. Customer, franchise aur franchise-ka-customer — teeno isi se chalte hain. |
| [otp.model.js](../src/modules/auth/otp.model.js) | OTP + **pending details** ka store. Yahan `pendingDetails` (name/email/dob/PAN/continent/country), `pendingFranchise` (plan + business), aur `franchise` / `franchiseCustomer` link rehta hai. |
| [sequence.js](../src/utils/sequence.js) | `LOAN000001`, `FRN000001` aur ab **`CUST000001`** banane wala counter. |

### Customer side
| File | Kaam |
|---|---|
| [auth.routes.js](../src/modules/auth/auth.routes.js) | `POST /api/auth/:product` (entry) + `POST /api/auth/verify-otp` + profile routes. |
| [auth.validator.js](../src/modules/auth/auth.validator.js) | Entry form ke field checks (name/email/mobile/dob/PAN/continent/country). Franchise entry inhi rules ko reuse karta hai (`entryFieldRules`). |
| [auth.controller.js](../src/modules/auth/auth.controller.js) | Sirf request/response — entry ka 200, verify ka token+wala JSON, profiles. |
| [user.model.js](../src/modules/auth/user.model.js) | Customer account. Naye fields: `customerId`, `dob`, `panNumber`. |
| [customer.routes.js](../src/modules/customer/customer.routes.js) | `GET /api/customer/loan-apply` (form config), `POST /api/customer/loan-apply` (submit), loans/status/summary. |
| [customer.service.js](../src/modules/customer/customer.service.js) | `getLoanApplyForm()` (kaunse field aate hain) + loan banao/list/detail/summary. |
| [customer.validator.js](../src/modules/customer/customer.validator.js) | Submit hone wale loan form ke rules (product ke hisaab se). |

### Franchise side (franchise ka apna account)
| File | Kaam |
|---|---|
| [franchise.routes.js](../src/modules/franchise/franchise.routes.js) | `GET /plans`, `POST /entry`, `POST /entry/verify`, `POST /login`, `GET /profile`, `GET /status`, `GET /loans`. |
| [franchise.validator.js](../src/modules/franchise/franchise.validator.js) | Entry ke rules (basic + **plan** + business), login, loan apply, customer OTP. |
| [franchise.controller.js](../src/modules/franchise/franchise.controller.js) | Entry/verify/login/profile/**status** (reject reason) /myLoans. |
| [franchise.model.js](../src/modules/franchise/franchise.model.js) | Franchise account: `franchiseStatus`, `franchiseId` (FRN), `plan` (snapshot), `package`, `businessDetails`, `password`. Naya field: `dob`. |
| [franchise.service.js](../src/modules/franchise/franchise.service.js) | Login (FRN+password), franchise ke customer ka loan, loans list. |

### Franchise ka apna customer (alag collection)
| File | Kaam |
|---|---|
| [franchiseCustomer.routes.js](../src/modules/franchise/franchiseCustomer.routes.js) | `POST /register`, `POST /:product/applyloan`, GET/PATCH customer, loans status. |
| (OTP verify ka route) | `POST /api/franchise/customer/verify-otp` ka **route** [franchise.routes.js](../src/modules/franchise/franchise.routes.js) me register hota hai (URL wahi hai), aur uska **handler** franchiseCustomer.controller me hai. Isliye dono file me iska zikr milega. |
| [franchiseCustomer.validator.js](../src/modules/franchise/franchiseCustomer.validator.js) | Customer details ke rules (`email` ab **zaroori**). |
| [franchiseCustomer.controller.js](../src/modules/franchise/franchiseCustomer.controller.js) | Register (OTP bhejta hai) + verify-otp + list/detail/update/loans. |
| [franchiseCustomer.model.js](../src/modules/franchise/franchiseCustomer.model.js) | Us customer ka record — `franchise` (owner) + `franchiseCode` (FRN). Naye fields: **`isVerified`**, `verifiedAt`. |
| [franchiseCustomer.service.js](../src/modules/franchise/franchiseCustomer.service.js) | `registerCustomer()` (save + OTP) aur **`verifyCustomerOtp()`** (account + CUST id). |

### Admin + shared
| File | Kaam |
|---|---|
| [admin/franchise.service.js](../src/modules/admin/franchise.service.js) | Approve (FRN + PAN password) / **reject (note save hota hai)**. Yahan kuch badla nahi — note pehle se save hota tha, ab dikhaya jaata hai. |
| [constants/roles.js](../src/constants/roles.js) | `USER_ROLE` + `FRANCHISE_STATUS`. Sirf comment update hua. |
| [middleware/franchise.middleware.js](../src/middleware/franchise.middleware.js) | `requireCustomer` / `requireFranchise` / `requireApprovedFranchise`. Kuch nahi badla. |

---

## 2. Har layer ka matlab (naming convention)

```
xxx.model.js       -> MongoDB me record ka shape (mongoose schema)
xxx.validator.js   -> request body ki checking; fail = 400 (express-validator)
xxx.routes.js      -> URL -> kaun sa middleware -> kaun sa controller
xxx.controller.js  -> request lo, status code + JSON do (business logic yahan nahi)
xxx.service.js     -> asli kaam: validation ke baad ka logic + DB read/write
xxx.rules.js /     -> loan product ke field-level rules (18 products ke liye)
xxx.schema.js
```

Ek request ka rasta:
```
URL -> routes.js -> validator (400?) -> controller -> service -> model (DB)
```

---

## 3. Kya UPDATE hua (aur kyun)

| File | Kya badla | Kyun |
|---|---|---|
| `auth/entry.service.js` | **Naya file** | Register/login hata diye, to account+ID+token banane ka kaam ek jagah chahiye tha — teeno role isse use karte hain |
| `auth/otp.model.js` | `pendingDetails`, `pendingFranchise`, `franchise`, `franchiseCustomer` | Step-1 par kuch save nahi karna tha, par verify par account banana tha — to data OTP ke saath pending rakha |
| `auth/user.model.js` | `customerId`, `dob`, `panNumber` | Customer ki public ID (`CUST000001`) + entry form ke identity fields |
| `auth/auth.routes.js` | `POST /:product` add, register/login hata, `:product` **sabse aakhir me** | Dynamic route pehle hota to `/verify-otp`, `/profile` usi me fas jaate |
| `auth/auth.validator.js` | `entryFieldRules` (reusable) + `entryValidator`; register/login validators gaye | Franchise entry bhi wahi basic rules use kare |
| `auth/auth.controller.js` | 429 → 150 line: sirf `entry` + `verifyOTP` + profiles | Register/login ke saare helper gaye |
| `customer/customer.service.js` | `getLoanApplyForm()` add, `validateApplyRegistration()` gaya | Verify ke baad form ka config GET se mile; purana "dob+PAN validate only" step bekaar ho gaya |
| `customer/customer.routes.js` | `GET /loan-apply` add, `POST /apply-register` gaya | Wahi wajah |
| `franchise/franchise.validator.js` | `franchiseEntryValidator` (basic + plan + business), `franchiseCustomerOtpValidator` add; `franchiseApplyValidator` gaya | Plan bhi ab entry me hi |
| `franchise/franchise.controller.js` | `entry`/`verifyEntry` the, `status` me **reject reason** + ID/password hataya; `apply` gaya | Tumne kaha: reject ki wajah dikhe, approved par bas login |
| `franchise/franchise.service.js` | `applyFranchise` + `findOrMigrateFranchise` gaye; **customer verify hone ka 403 guard** add | Apply entry me chala gaya; customer ke bina OTP loan nahi |
| `franchise/franchiseCustomer.*` | `isVerified`/`verifiedAt`, `register` par OTP, naya `/verify-otp` (route `franchise.routes.js`, handler `franchiseCustomer.controller.js`), `email` required | Customer ki consent (uske phone par OTP) ke bina loan nahi |
| `franchise.model.js` | `dob` add | Franchise entry bhi DOB maangti hai |
| `constants/roles.js` | Sirf comment | Purana comment `/api/auth/register` bol raha tha |

---

## 4. Kya DELETE hua

| Kya | Kahan | Kyun |
|---|---|---|
| `POST /api/auth/register` | auth.routes | signup concept hi khatam |
| `POST /api/auth/login/request-otp` | auth.routes | customer login OTP request |
| `POST /api/auth/login/:product/verify-otp` | auth.routes | OTP verify + product-specific cooldown |
| (note) purane `POST /api/auth/register` / `login` ab **404 nahi, 400** dete hain — dynamic `POST /api/auth/:product` unhe product samajh leta hai aur product check fail hota hai. Functionality khatam hai, status code badla hua hai. | — | verify kiya gaya behaviour |
| `POST /api/customer/apply-register` | customer.routes | dob/PAN ab entry form me |
| `POST /api/franchise/apply` | franchise.routes | plan+business ab entry me |
| `register`, `login`, `verifyLoginOTP` | auth.controller | unke routes gaye |
| `applyRegister` | customer.controller | route gaya |
| `apply` | franchise.controller | route gaya |
| `findAccountForMobile`, `conflictInOtherCollection`, `authUserResponse`, `nextStepFor` | auth.controller | sirf register/login ke the |
| `applyFranchise`, `findOrMigrateFranchise`, `PAN_REGEX` | franchise.service | apply gaya |
| `validateApplyRegistration` | customer.service | step-1 gaya |
| `registerValidator`, `loginValidator`, `verifyLoginOtpValidator` | auth.validator | register/login gaye |
| `applyRegisterValidator` | customer.validator | step-1 gaya |
| `franchiseApplyValidator` | franchise.validator | apply gaya |
| `tests/auth.otp-response.test.js` | **poori file** | wo file sirf register/login ke OTP responses test karti thi |
| 2 `describe` blocks | tests/franchise.collection.test.js | register-flow + mobile-OTP flow (deleted code) |
| 1 test + 1 test | tests/franchise.test.js, tests/validators.test.js | `registerValidator` ke test |

---

## 5. Test files — kya hua aur `describe`/`it` ka matlab

**`describe`** = ek group ka naam (feature), **`it`** = ek single check. `npm test` chalane par har
`it` run hota hai aur pass/fail batata hai. Ye "unit tests" hain — chhote functions ko
seedha call karke check karte hain, HTTP server chalaye bina.

| Test file | Kya karta hai | Maine kya kiya |
|---|---|---|
| `tests/auth.otp-response.test.js` | register/login ke OTP responses | **poori file delete** (test ki gayi cheez hi nahi rahi) |
| `tests/customer.test.js` | loan validators + status view | `apply-register` wale 104 line delete, baaki waise hi |
| `tests/franchise.collection.test.js` | franchise login, admin approve, approval gate | register-flow ke 266 line delete; baaki 3 describe waise hi |
| `tests/franchise.test.js` | validators, role guards, sequence | `registerValidator` block hata, uski jagah **entry validator** ka test |
| `tests/franchisePlan.test.js` | plan snapshot + plan validators | apply validator ka block **entry validator** ke liye update |
| `tests/franchiseCustomer.test.js` | franchise ka customer + uska loan | OTP model + sendOTP ka **stub** add, aur fixture me `isVerified: true` |
| `tests/validators.test.js` | 18 loan products ke validators/controllers | ek `registerValidator` block (30 line) hata, baaki 1200+ line waise hi |
| `tests/adminFranchiseCustomers.test.js`, `auth.profile.test.js`, `franchise.model.test.js`, `utils.validators.test.js` | admin views, profiles, model, utils | **kuch touch nahi kiya** |

### `validators.test.js` me itna static data kyun hai?

Wo purana file hai (1308 line) aur uske andar har loan product ke liye **sample form data**
(hardcoded) rakha gaya hai — jaise:

```js
const validPayload = { loanAmount: 500000, loanTenure: 2, fullName: "Test User", mobile: "9876543210" };
```

Ye "dummy applicant" hai — test ko ek asli form jaisa payload chahiye hota hai taaki validator
chal sake. Isme koi DB call nahi hoti, isliye ye data hardcoded hai. Maine is file me sirf
**ek block** (purana `registerValidator` test) hataya hai; uska data maine likha hi nahi.

---

## 6. Note: maine koi test/API script project me nahi chhodi

Maine jo chalaya wo sirf **one-liner commands** the (file me save nahi kiye):
`node --check <file>` (syntax), `node -e "require('./src/app')"` (sab module load ho rahe hain),
aur route-table print (kaun sa URL register hua). Koi Postman collection, koi test script,
koi `.js` file project me nahi banayi — `git status` me sirf ek naya source file hai:
[entry.service.js](../src/modules/auth/entry.service.js), plus docs.

`npm test` maine **jaan-boojhkar nahi chalaya** (tumne mana kiya tha) — wo tum chalao.
