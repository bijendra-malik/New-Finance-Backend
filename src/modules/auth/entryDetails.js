/*
==========================================
Entry details vs loan form details.

Mobile OTP sirf ek hi baat prove karta hai: yahi insaan hai. Usne entry form
(`POST /api/auth/:product`) me jo name / mobile / email / DOB / PAN diye the,
wahi details verify hone par account par save hote hain (entry.service.js).

Loan form me bhi WAHI details honi chahiye — warna token ek customer ka aur
application kisi doosre ka ban jaata hai. Ye module sirf wahi ek check rakhta
hai, aur do jagah use hota hai:

  middleware/entryDetails.middleware.js   -> POST /api/customer/loan-apply
  loans/shared/loan.service.js (apply)    -> POST /api/<product>/apply

Rules:
  - form me bheji value account se match nahi karti -> mismatch (caller 400 deta hai)
  - form me field bheji hi nahi                     -> account ki verified value lag jaati hai

Sirf entry wale 5 fields check hote hain. `state` / `city` / `pincode` /
`residenceStatus` entry form me hi nahi aate, isliye wo applicant khud bharta hai.
==========================================
*/

/** Entry me verify hui identity fields: form ka naam -> account ka field. */
const ENTRY_FIELDS = [
  { field: "fullName", accountKey: "name", label: "Full name" },
  { field: "mobile", accountKey: "mobile", label: "Mobile number" },
  { field: "email", accountKey: "email", label: "Email" },
  { field: "panNumber", accountKey: "panNumber", label: "PAN number" },
  { field: "dob", accountKey: "dob", label: "Date of birth" },
];

const cleanText = (value) => String(value ?? "").trim();

const isEmpty = (value) => value === undefined || value === null || value === "";

/** YYYY-MM-DD — DOB ko date ke hisaab se compare karte hain, string se nahi. */
const asDateOnly = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

/**
 * Compare karne ka roop: text case-insensitive + extra spaces ignore ("Rahul  Sharma"
 * aur "rahul sharma" ek hi hain), DOB sirf date-only.
 */
const comparable = (field, value) =>
  field === "dob" ? asDateOnly(value) : cleanText(value).replace(/\s+/g, " ").toLowerCase();

/** Message me dikhane ka roop. */
const displayValue = (field, value) => (field === "dob" ? asDateOnly(value) : cleanText(value));

/**
 * Body ki identity details ko account ki verified details se milata hai.
 *
 * Kuch return nahi karta — mismatch par `{ field, message }` deta hai; aur jo
 * field body me nahi bheji gayi wo account ki verified value se bhar deta hai
 * (isliye caller ko `body` dobara padhna nahi padta).
 */
const findEntryDetailMismatch = (account, body) => {
  if (!account) return null;

  const data = body && typeof body === "object" && !Array.isArray(body) ? body : {};

  for (const { field, accountKey, label } of ENTRY_FIELDS) {
    const verified = account[accountKey];
    const sent = data[field];

    // Field bheji hi nahi -> verified value hi lag jaati hai.
    if (isEmpty(sent)) {
      if (!isEmpty(verified)) data[field] = verified;
      continue;
    }

    /*
    Purane (entry se pehle ke) account par kuch identity fields khaali hoti hain
    — jahan account ki value hi nahi hai wahan compare karna galat 400 dega,
    isliye sirf tab check karte hain jab verified value maujood ho.
    */
    if (isEmpty(verified)) continue;

    if (comparable(field, sent) !== comparable(field, verified)) {
      return {
        field,
        message: `${label} does not match the details you verified at loan entry. Please use the same ${label.toLowerCase()} (${displayValue(
          field,
          verified
        )}).`,
      };
    }
  }

  return null;
};

/** Token ka account na mile (delete ho gaya / purana token) to yahi message jaata hai. */
const ACCOUNT_NOT_FOUND_MESSAGE = "Account not found. Please verify your mobile number again.";

module.exports = {
  ENTRY_FIELDS,
  findEntryDetailMismatch,
  ACCOUNT_NOT_FOUND_MESSAGE,
};
