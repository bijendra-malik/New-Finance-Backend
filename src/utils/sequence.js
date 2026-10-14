const mongoose = require("mongoose");

/*
==========================================
Human-readable ID sequences.

The database `_id` is already a unique key per record, but the business wants
short, speakable ids (LOAN000001, FRN000125) for tracking. They are minted from
one atomic counter per namespace, so two concurrent applications can never
receive the same number.

`bufferCommands: false` keeps the counter from silently waiting on a missing
database connection; when there is no connection the sequence falls back to a
random id instead of hanging.
==========================================
*/

const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 },
  },
  { timestamps: true, bufferCommands: false }
);

const Counter = mongoose.model("Counter", counterSchema);

/** Atomically increments and returns the next value for `key` (starts at 1). */
const nextSequence = async (key) => {
  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return doc.value;
};

/** "FRN" + 125 -> "FRN000125" */
const formatId = (prefix, value, width = 6) =>
  `${prefix}${String(value).padStart(width, "0")}`;

const randomId = (prefix) => formatId(prefix, Math.floor(Math.random() * 1000000));

/** Per-application id shown in the dashboard (e.g. LOAN000001). */
const nextLoanApplicationNo = async () => {
  try {
    return formatId("LOAN", await nextSequence("loanApplication"));
  } catch (error) {
    return randomId("LOAN");
  }
};

/** Per-franchise id minted when an admin approves the application. */
const nextFranchiseCode = async () => {
  try {
    return formatId("FRN", await nextSequence("franchise"));
  } catch (error) {
    return randomId("FRN");
  }
};

/*
Per-customer id minted the moment the mobile OTP is verified (CUST000001).

Yahi id customer ki public identity hai: status check me isi se pata chalta hai
ki caller customer hai (CUST...) ya franchise (FRN...), aur isi se uske saare
loans dhoondhe jaate hain. Account ke saath hi ek hi baar banti hai — dobara
entry karne par wahi id wapas milti hai.
*/
const nextCustomerId = async () => {
  try {
    return formatId("CUST", await nextSequence("customer"));
  } catch (error) {
    return randomId("CUST");
  }
};

module.exports = {
  Counter,
  nextSequence,
  formatId,
  nextLoanApplicationNo,
  nextFranchiseCode,
  nextCustomerId,
};
