# ADD-NEW-LOAN — Beginner Checklist

Follow these steps in order. Example product used below: **Car Loan** (key: `carLoan`).
Replace `carLoan` / `CarLoan` / `car-loan` / `/api/car-loan` with your product everywhere.

**Golden rule:** the requirement key (`carLoan`) must be EXACTLY the same in these 3 files —
`modules/loans/shared/loanValidator.js`, `modules/loans/shared/loanSchema.js`,
`modules/loans/shared/loanProducts.js`.

**Folder rule:** everything for one product lives in ONE folder —
`src/modules/loans/<product>/`. You never touch another product's folder.

---

## The layout you are aiming for

```
src/modules/loans/
├── shared/                    <- engine + registries, shared by every product
│   ├── loanProducts.js        <- THE switchboard (config per product)
│   ├── loanSchema.js          <- which fields each product stores
│   ├── loanValidator.js       <- which fields each product validates
│   ├── loan.service.js        <- the one business-logic engine
│   ├── loanBasics.schema.js / loanBasics.rules.js
│   ├── personalDetails.schema.js / personalDetails.rules.js
│   ├── existingLoanExposure.schema.js / existingLoanExposure.rules.js
│   ├── incomeSalaried.schema.js / incomeSalaried.rules.js
│   ├── incomeSelfEmployed.schema.js / incomeSelfEmployed.rules.js
│   ├── incomeEmployment.schema.js
│   ├── employmentType.rules.js
│   └── helpers.js
│
└── car-loan/                  <- ONE product, fully self-contained
    ├── carLoan.model.js
    ├── carLoan.service.js
    ├── carLoan.controller.js
    ├── carLoan.validator.js
    ├── carLoan.routes.js
    ├── carLoan.requirements.schema.js
    └── carLoan.requirements.rules.js
```

---

## Step 0 — Plan (2 minutes, no code)

- [ ] Folder name: `car-loan` (kebab-case)
- [ ] Route: `/api/car-loan`
- [ ] loanType name: `"Car Loan"`
- [ ] Employment types allowed: `EMPLOYMENT_TYPES.personal` (Salaried only) · `.business` (Business+Professional) · `.home` (all three)
- [ ] List your OWN fields (everything else — Personal / Income / Exposure — is reused automatically)

## Step 1 — Create the product folder + the requirements pair

```bash
mkdir src/modules/loans/car-loan
cp src/modules/loans/balance-transfer/balanceTransfer.requirements.schema.js src/modules/loans/car-loan/carLoan.requirements.schema.js
cp src/modules/loans/balance-transfer/balanceTransfer.requirements.rules.js  src/modules/loans/car-loan/carLoan.requirements.rules.js
```

| Copy from                                                                        | Create                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/modules/loans/balance-transfer/balanceTransfer.requirements.schema.js`       | `src/modules/loans/car-loan/carLoan.requirements.schema.js`          |
| `src/modules/loans/balance-transfer/balanceTransfer.requirements.rules.js`        | `src/modules/loans/car-loan/carLoan.requirements.rules.js`           |

- `.requirements.schema.js` → one entry per field: `type` (String/Number/Date), `required: [true, "message"]`
- `.requirements.rules.js` → one `body("field")...` rule per field

> No own fields (like Personal Loan / Business Loan)? Skip this step entirely —
> leave `loanRequirements` off in Step 4.

## Step 2 — Register in the two shared registries

**`src/modules/loans/shared/loanSchema.js`** — 3 additions:

```js
const { carLoanRequirementFields } = require("../car-loan/carLoan.requirements.schema");
// inside loanRequirementSections:      carLoan: carLoanRequirementFields,
// inside loanRequirementFieldNames:    carLoan: Object.keys(carLoanRequirementFields),
```

**`src/modules/loans/shared/loanValidator.js`** — 2 additions:

```js
const { carLoanRequirementRules } = require("../car-loan/carLoan.requirements.rules");
// inside requirementRules:             carLoan: carLoanRequirementRules,
```

## Step 3 — Copy the 5 boilerplate files into the product folder

Copy all of `src/modules/loans/balance-transfer/` and rename to `carLoan`:

| Copy from                              | Create                                            |
| -------------------------------------- | ------------------------------------------------- |
| `balance-transfer/balanceTransfer.model.js`      | `car-loan/carLoan.model.js`      |
| `balance-transfer/balanceTransfer.service.js`    | `car-loan/carLoan.service.js`    |
| `balance-transfer/balanceTransfer.controller.js` | `car-loan/carLoan.controller.js` |
| `balance-transfer/balanceTransfer.validator.js`  | `car-loan/carLoan.validator.js`  |
| `balance-transfer/balanceTransfer.routes.js`     | `car-loan/carLoan.routes.js`     |

Change only the product key inside them:

- `carLoan.model.js` → `mongoose.model("CarLoan", buildLoanSchema("carLoan"))`
- `carLoan.service.js` → `const PRODUCT_KEY = "carLoan";` (and keep the `sanitizeCarLoanResponse` name)
- `carLoan.controller.js` → just re-exports the service, no edits needed
- `carLoan.validator.js` → `buildApplyValidator("carLoan")`
- `carLoan.routes.js` → POST `/apply` + GET `/applications` (only the controller import path changes)

## Step 4 — One block in `src/modules/loans/shared/loanProducts.js`

Copy the `balanceTransfer` block and change the values:

```js
carLoan: {
  product: "carLoan",
  loanType: "Car Loan",
  loanTypeEnum: ["Car Loan"],
  route: "/api/car-loan",
  employmentTypes: EMPLOYMENT_TYPES.home,
  employmentTypeRequired: true,
  employmentTypeMessage: "Employment type is invalid",
  income: "employment",            // "salaried" | "selfEmployed" | "employment"
  personalDetailsRequired: true,
  exposureRequired: false,
  loanRequirements: "carLoan",     // SAME key as Step 2
  loanAmountMin: 1,
  loanAmountMessage: "Car loan amount is required and must be positive",
  loanTenureMin: 1,
  loanTenureMessage: "Car loan tenure is required and must be a positive number of months",
  salary: { min: 0, message: "Monthly salary is required" },
  gstFormat: false,
  adultApplicant: false,
  normalizeBankOnResponse: false,
},
```

Also add the model to the `MODELS` map in `src/modules/loans/shared/loan.service.js`:

```js
carLoan: CarLoan,
```

## Step 5 — Mount the route in `src/app.js` (1 line)

```js
app.use("/api/car-loan", require("./modules/loans/car-loan/carLoan.routes"));
```

## Step 6 — Admin panel (2 edits)

- `src/modules/admin/application.controller.js` — import model + controller, add `listCarLoans` + `getCarLoanById` (copy the balance transfer pair)
- `src/modules/admin/application.routes.js` — 2 lines:

```js
router.get("/car-loans", applicationController.listCarLoans);
router.get("/car-loans/:id", applicationController.getCarLoanById);
```

## Step 7 — "Other" dropdown fields (only if you have them)

`src/utils/normalizeLoanPayload.js` → `OTHER_FIELD_PAIRS`:

```js
["carType", "carTypeOther"],
```

## Step 8 — Tests + verify

- [ ] `tests/validators.test.js` — copy the `balanceTransfer` describe block, rename (4 tests)
- [ ] `npx jest` → all pass
- [ ] Temp server par asli request se verify: `env PORT=5055 node src/server.js &` phir Postman/curl se apply + list → `201 { "success": true, ... }`; server band karo
- [ ] Restart your real server (`npm start`), then test in Postman: `POST http://localhost:5000/api/car-loan/apply` with `Authorization: Bearer <user JWT>`

---

**Done when:** `npx jest` passes, Postman returns `201 { "success": true, ... }`, and admin list shows the record.

**Total per product:** 7 files in the product folder + 4 small edits in `shared/` + 1 line in `app.js` + 2 admin edits.
