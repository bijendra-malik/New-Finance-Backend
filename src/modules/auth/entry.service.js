const User = require("./user.model");
const Franchise = require("../franchise/franchise.model");
const OTP = require("./otp.model");
const sendOTP = require("../../utils/sendOTP");
const generateToken = require("../../utils/generateToken");
const franchisePlanService = require("../franchise/franchisePlan.service");
const { nextCustomerId } = require("../../utils/sequence");
const { freshOtp, maskMobile } = require("../../utils/otp");
const { LOAN_PRODUCTS } = require("../loans/shared/loanProducts");
const { MODELS } = require("../loans/shared/loanModels");
const { USER_ROLE, FRANCHISE_STATUS } = require("../../constants/roles");
const { creditStatus } = require("../customer/credit.service");

/*
==========================================
Entry service — teeno darwazon ka engine.

  POST /api/auth/:product                       customer ka per-loan entry
  POST /api/auth/verify-otp

  POST /api/franchise/entry                     franchise entry (plan + business
  POST /api/franchise/entry/verify               details ke saath)

  POST /api/franchise/customer/register         franchise apne customer ka OTP
  POST /api/franchise/customer/verify-otp        bhejta hai (customer ke phone par)

Do step har jagah same hain:

  1. startEntry()   — form ki details OTP document me PENDING rakhta hai aur SMS
                      bhejta hai. Koi account nahi banta, isliye adhoora form
                      chhodhne par koi half-filled record nahi bachta.
  2. verifyEntry()  — OTP match hone par hi account banta hai (ya purana wala hi
                      rehta hai), usi waqt CUST id mint hoti hai aur JWT milti hai.

Customer/franchise ka farq sirf `role` se aata hai; franchise me plan + business
details bhi pending rehti hain aur verify par franchise hi Pending ban jaata hai
(alag se koi "apply" step nahi hai).
==========================================
*/

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MOBILE_REGEX = /^\d{10}$/;

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const conflict = (message) => {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
};

const notFound = (message) => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

const serverError = (message) => {
  const error = new Error(message);
  error.statusCode = 500;
  return error;
};

const cleanText = (value) => String(value ?? "").trim();

/** Body ko unwrap karta hai — kuch clients `{ data: { ... } }` bhejte hain. */
const unwrap = (body) =>
  body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body || {};

/** Poori umar (saal me). */
const ageInYears = (birthDate) => {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  return age;
};

/*
Entry ka OTP sirf entry documents par chalta hai. Status (`purpose: "status"`),
login (`purpose: "login"`) aur franchise-status OTPs alag rehte hain, isliye ek
doore ko replace ya verify nahi karte. Purane (purpose field ke bina bane)
documents null branch se entry ke hi maane jaate hain.
*/
const ENTRY_OTP_FILTER = { purpose: { $in: ["entry", null] } };

/*
OTP ki koi expiry nahi hai (jaan-boojh kar).

Entry ka OTP doc mobile ke saath pada rehta hai jab tak koi naya entry usi mobile
ka OTP replace na kar de, aur wahi OTP jitni baar chaho verify kiya ja sakta hai —
lamba testing isi wajah se rukta nahi. Isliye verify me sirf OTP value match hoti
hai, koi "purana ho gaya" check nahi.

(Bahut purane OTP documents par jo TTL index lagā tha wo boot par hata diya jaata
hai — config/database.js — warna driver hi doc delete kar deta.)
*/

/*
Step-1 form ka payload -> account fields. Validator pehle hi check kar chuka
hota hai; ye dobara check isliye hai ki service ko seedha call karne par bhi
(data ka bharosa karne ke bajaye) wahi clear 400 error mile.
*/
const buildPendingDetails = (body = {}) => {
  const payload = unwrap(body);

  const name = cleanText(payload.name);
  if (!name) throw badRequest("Name is required");

  const mobile = cleanText(payload.mobile);
  if (!MOBILE_REGEX.test(mobile)) throw badRequest("Enter a valid 10-digit mobile number");

  const email = cleanText(payload.email).toLowerCase();
  if (!email) throw badRequest("Email is required");

  const panNumber = cleanText(payload.panNumber).toUpperCase();
  if (!PAN_REGEX.test(panNumber)) throw badRequest("Enter a valid PAN number (e.g. ABCDE1234F)");

  const rawDob = payload.dob;
  const dob = rawDob ? new Date(rawDob) : null;
  if (!dob || Number.isNaN(dob.getTime())) {
    throw badRequest("Enter a valid date of birth (YYYY-MM-DD)");
  }
  if (ageInYears(dob) < 18) {
    throw badRequest("Applicant must be at least 18 years old to apply for a loan");
  }

  /*
  Entry form se continent, country, city aur pincode capture hote hain. State
  franchise entry ke is form ka hissa nahi hai.
  */
  return {
    name,
    mobile,
    email,
    dob,
    panNumber,
    continent: cleanText(payload.continent),
    country: cleanText(payload.country),
    city: cleanText(payload.city),
    pincode: cleanText(payload.pincode),
  };
};

/* Franchise entry ka extra hissa — plan + business data. */
const buildPendingFranchise = (body = {}) => {
  const payload = unwrap(body);

  const planCode = cleanText(payload.planCode).toUpperCase();
  // Purana free-text package — backward compat ke liye abhi bhi chalta hai.
  const pkg = cleanText(payload.package);

  if (!planCode && !pkg) {
    throw badRequest("Please select a franchise plan before continuing");
  }

  return {
    planCode,
    package: pkg,
    businessName: cleanText(payload.businessName),
    businessType: cleanText(payload.businessType),
    gstNumber: cleanText(payload.gstNumber).toUpperCase(),
    address: cleanText(payload.address),
    yearsInBusiness: cleanText(payload.yearsInBusiness),
  };
};

/** Ek hi save point — duplicate email/customerId par saaf 409. */
const saveAccount = async (account) => {
  try {
    await account.save();
  } catch (error) {
    if (error && error.code === 11000) {
      const field = Object.keys(error.keyValue || {})[0];
      if (field === "email") {
        throw conflict("This email is already linked to another customer account.");
      }
      if (field === "mobile") {
        throw conflict("This mobile is already linked to another customer account.");
      }
      throw conflict("This customer account conflicts with an existing email or mobile.");
    }
    throw error;
  }
};

/*
Customer account — mobile se dhoondha jaata hai.
  naya    -> CUST id mint hoti hai
  purana  -> WAHI CUST id rehti hai, aur jo details abhi bhari gayi wahi save
             hoti hain (mobile OTP hi prove karta hai ki ye wahi insaan hai,
             isliye galat type ki hui detail khud theek ho jaati hai)
*/
const upsertCustomer = async (mobile, details) => {
  const existing = await User.findOne({ mobile });

  if (!existing) {
    const account = new User({
      name: details.name,
      mobile,
      email: details.email,
      dob: details.dob,
      panNumber: details.panNumber,
      continent: details.continent,
      country: details.country,
      city: details.city,
      pincode: details.pincode,
      role: USER_ROLE.CUSTOMER,
      customerId: await nextCustomerId(),
    });
    return { account, isNew: true };
  }

  existing.name = details.name;
  if (existing.email !== details.email) {
    const emailOwner = await User.findOne({ email: details.email });
    if (!emailOwner || String(emailOwner._id) === String(existing._id)) {
      existing.email = details.email;
    }
  }
  existing.dob = details.dob;
  existing.panNumber = details.panNumber;

  /*
  Location sirf tab overwrite karo jab nayi value khaali na ho — franchise apne
  customer ka OTP bhejta hai to uske paas continent/country nahi hote, aur ek
  khaali value se customer ka pehle ka data mit jaana galat hota.
  */
  if (details.continent) existing.continent = details.continent;
  if (details.country) existing.country = details.country;
  if (details.city) existing.city = details.city;
  if (details.pincode) existing.pincode = details.pincode;

  // Migration se pehle ka account — jiske paas CUST id nahi hai.
  if (!existing.customerId) existing.customerId = await nextCustomerId();

  return { account: existing, isNew: false };
};

/*
Franchise account — mobile se dhoondha jaata hai.

Purana franchise record entry kabhi overwrite nahi karti: uski PAN hi admin ke
approve karne par initial password banti hai, aur uski application already chal
rahi hoti hai. Isliye sirf khaali fields bhar jaate hain.
*/
const upsertFranchise = async (mobile, details) => {
  const existing = await Franchise.findOne({ mobile });

  if (!existing) {
    const account = new Franchise({
      name: details.name,
      mobile,
      email: details.email,
      dob: details.dob,
      panNumber: details.panNumber,
      continent: details.continent,
      country: details.country,
      city: details.city,
      pincode: details.pincode,
      franchiseStatus: FRANCHISE_STATUS.NONE,
    });
    return { account, isNew: true };
  }

  const fillIfEmpty = (field) => {
    if (!existing[field] && details[field]) existing[field] = details[field];
  };

  ["name", "email", "dob", "panNumber", "continent", "country", "city", "pincode"].forEach(fillIfEmpty);

  return { account: existing, isNew: false };
};

/*
Franchise application entry ke saath hi poori ho jaati hai (plan + business
details), isliye verify par status seedha Pending ho jaata hai. Alag "apply" step
nahi hai.
*/
const applyFranchiseApplication = async (account, pending) => {
  // Approved franchise ka record entry kabhi nahi chhedta (PAN = password).
  if (account.franchiseStatus === FRANCHISE_STATUS.APPROVED) return;

  // Plan ka SNAPSHOT banta hai (sirf id nahi) — baad me fee badalne par bhi
  // partner ke record me wahi price rehti hai jo usne apply karte waqt dekhī thi.
  const planSnapshot = pending?.planCode
    ? franchisePlanService.buildPlanSnapshot(
        await franchisePlanService.resolveActivePlan(pending.planCode)
      )
    : null;

  account.plan = planSnapshot;
  // `package` plan ke naam ke saath sync rehta hai; plan na chuna ho to jo bheja gaya wahi.
  account.package = planSnapshot ? planSnapshot.name : cleanText(pending?.package);
  account.businessDetails = {
    businessName: cleanText(pending?.businessName),
    businessType: cleanText(pending?.businessType),
    gstNumber: cleanText(pending?.gstNumber),
    address: cleanText(pending?.address),
    yearsInBusiness: cleanText(pending?.yearsInBusiness),
  };
  account.franchiseStatus = FRANCHISE_STATUS.PENDING;
  account.franchiseAppliedAt = new Date();
  account.franchiseRejectedAt = null;
};

/** Client ko batata hai ki agla screen kaun sa hai. */
const nextStepFor = (role, account) => {
  if (role !== USER_ROLE.FRANCHISE) return "loan-apply";

  if (account.franchiseStatus === FRANCHISE_STATUS.APPROVED) return "franchise-dashboard";
  if (account.franchiseStatus === FRANCHISE_STATUS.PENDING) return "franchise-pending";
  if (account.franchiseStatus === FRANCHISE_STATUS.REJECTED) return "franchise-rejected";
  return "franchise-apply";
};

const asDateOnly = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

/* Response shape — password kabhi nahi, OTP kabhi nahi. */
const buildResponse = ({ role, account, product }) => {
  if (role === USER_ROLE.FRANCHISE) {
    const plan = account.plan;

    return {
      idType: "franchise",
      nextStep: nextStepFor(role, account),
      franchiseStatus: account.franchiseStatus || FRANCHISE_STATUS.NONE,
      franchiseId: account.franchiseId || null,
      package: account.package || "",
      plan: plan
        ? { code: plan.code, name: plan.name, fee: plan.fee, totalWithGst: plan.totalWithGst }
        : null,
      user: {
        _id: account._id,
        name: account.name,
        mobile: account.mobile,
        email: account.email,
        dob: asDateOnly(account.dob),
        panNumber: account.panNumber || "",
        continent: account.continent || "",
        country: account.country || "",
        city: account.city || "",
        pincode: account.pincode || "",
        franchiseStatus: account.franchiseStatus || FRANCHISE_STATUS.NONE,
        franchiseId: account.franchiseId || null,
        isVerified: account.isVerified,
      },
    };
  }

  const config = LOAN_PRODUCTS[product];
  const credit = creditStatus(account);

  return {
    idType: "customer",
    customerId: account.customerId,
    product,
    loanType: config ? config.loanType : "",
    nextStep: credit.eligible ? "loan-apply" : "credit-score",
    credit,
    user: {
      _id: account._id,
      customerId: account.customerId,
      name: account.name,
      mobile: account.mobile,
      email: account.email,
      dob: asDateOnly(account.dob),
      panNumber: account.panNumber || "",
      continent: account.continent || "",
      country: account.country || "",
      city: account.city || "",
      pincode: account.pincode || "",
      role: account.role,
      isVerified: account.isVerified,
      isActive: account.isActive,
    },
  };
};

/* ------------------------------------------------------- step 1: OTP bhejo -- */

const startEntry = async ({
  role,
  product = "",
  body = {},
  franchise = null,
  franchiseCustomer = null,
}) => {
  const isFranchise = role === USER_ROLE.FRANCHISE;

  /*
  Franchise apne customer ka OTP bhej raha ho to product ki zaroorat nahi (product
  loan apply ke waqt chuna jaata hai). Direct customer entry me product zaroori hai.
  */
  if (!isFranchise && !franchiseCustomer && !LOAN_PRODUCTS[product]) {
    throw badRequest("A valid loan product is required");
  }

  const details = buildPendingDetails(body);

  if (!isFranchise && !franchiseCustomer) {
    const existingCustomer = await User.findOne({ mobile: details.mobile });
    const loanModel = MODELS[product];
    const existingApplication = existingCustomer
      ? await loanModel.exists({ user: existingCustomer._id, franchise: null })
      : null;

    if (existingApplication) {
      throw conflict(
        `You have already applied for the ${LOAN_PRODUCTS[product].loanType}. Please login with your mobile number to continue.`
      );
    }
  }

  // Jo franchise already approved hai usko dobara entry ki zaroorat nahi — login kare.
  if (isFranchise) {
    const approved = await Franchise.findOne({
      mobile: details.mobile,
      franchiseStatus: FRANCHISE_STATUS.APPROVED,
    });
    if (approved) {
      throw conflict(
        "This mobile is already an approved franchise. Please login with your franchise ID and password."
      );
    }
  }

  const pendingFranchise = isFranchise ? buildPendingFranchise(body) : null;

  // Plan pehle hi verify kar lete hain, taaki OTP bhejne ke baad surprise na ho.
  if (pendingFranchise?.planCode) {
    await franchisePlanService.resolveActivePlan(pendingFranchise.planCode);
  }

  const otp = freshOtp();

  // Ek mobile ka ek hi live entry-OTP — naya entry purane wale ko replace karta hai.
  await OTP.deleteMany({ mobile: details.mobile, ...ENTRY_OTP_FILTER });

  await OTP.create({
    mobile: details.mobile,
    otp,
    role,
    product: isFranchise ? "" : product,
    pendingDetails: details,
    pendingFranchise,
    franchise: franchise?._id || null,
    franchiseCustomer: franchiseCustomer?._id || null,
  });

  const otpSent = await sendOTP(details.mobile, otp);
  if (!otpSent) throw serverError("Unable to send OTP. Please try again later.");

  return {
    mobile: details.mobile,
    mobileMasked: maskMobile(details.mobile),
    product: isFranchise ? "" : product,
  };
};

/* -------------------------------------------- step 2: verify -> account -- */

const verifyEntry = async ({
  mobile,
  otp,
  expectedRole = "",
  expectedFranchiseCustomerId = "",
  issueToken = true,
}) => {
  const verifiedMobile = cleanText(mobile);
  const submittedOtp = cleanText(otp);
  if (!MOBILE_REGEX.test(verifiedMobile)) {
    throw badRequest("Enter a valid 10-digit mobile number");
  }
  if (!submittedOtp) throw badRequest("OTP is required");

  const otpData = await OTP.findOne({ mobile: verifiedMobile, ...ENTRY_OTP_FILTER });

  if (!otpData) throw badRequest("OTP Not Found");
  /* OTP ki koi expiry nahi — sirf value match honi chahiye. */
  if (String(otpData.otp) !== submittedOtp) throw badRequest("Invalid OTP");

  const accountMobile = cleanText(otpData.mobile);
  if (!MOBILE_REGEX.test(accountMobile)) {
    throw badRequest("Entry mobile number not found. Please request a new OTP.");
  }

  const role = otpData.role || USER_ROLE.CUSTOMER;

  /*
  Customer ka OTP franchise ke verify route par na chale (aur ulta bhi) — dono
  entry ke apne URL hain, isliye mismatch saaf 400 deta hai.
  */
  if (expectedRole && role !== expectedRole) {
    throw badRequest("This OTP was sent for a different entry. Please start again.");
  }

  /*
  Franchise ke customer ka OTP sirf usi franchise ke usi customer ke liye chalta
  hai jiske liye bheja gaya tha.
  */
  if (expectedFranchiseCustomerId) {
    if (String(otpData.franchiseCustomer || "") !== String(expectedFranchiseCustomerId)) {
      throw badRequest("This OTP was sent for a different entry. Please start again.");
    }
  }

  const product = role === USER_ROLE.FRANCHISE ? "" : otpData.product || "";
  const isFranchise = role === USER_ROLE.FRANCHISE;

  if (otpData.verifiedAt) {
    const Model = isFranchise ? Franchise : User;
    const account = await Model.findOne({ mobile: accountMobile });

    if (!account) {
      await OTP.deleteMany({ mobile: verifiedMobile, ...ENTRY_OTP_FILTER });
      throw badRequest("Account not found. Please request a new OTP.");
    }

    const payload = buildResponse({ role, account, product });

    /*
    Token me entry ka product — uske baad apply sirf usi product ka chalta hai
    (middleware/entryProduct.middleware.js).
    */
    return issueToken
      ? { token: generateToken(account, { product: isFranchise ? "" : product }), ...payload }
      : payload;
  }

  /*
  Purane (entry se pehle ke) OTP documents me details nahi hoti — unse account
  banana galat hoga, isliye saaf message ke saath form dobara mangwa lete hain.
  */
  const details = otpData.pendingDetails;
  /*
  Account banate waqt User/Franchise model name + email required maangta hai.
  Schema update se pehle bane purane OTP docs adhoore ho sakte hain (sirf
  name) — unhe mongoose ValidationError ("Mobile number is required") ke
  bajaye yahin clear message dekar hata dete hain.
  */
  if (!details || !details.name || !details.email) {
    await OTP.deleteMany({ mobile: verifiedMobile, ...ENTRY_OTP_FILTER });
    throw badRequest("Entry details not found. Please fill the form again.");
  }

  const { account } = isFranchise
    ? await upsertFranchise(accountMobile, details)
    : await upsertCustomer(accountMobile, details);

  // Franchise entry me plan + business details bhi yahin utarti hain -> Pending.
  if (isFranchise) await applyFranchiseApplication(account, otpData.pendingFranchise);

  account.isVerified = true;
  account.lastLogin = new Date();

  await saveAccount(account);

  otpData.verifiedAt = new Date();
  await otpData.save();

  const payload = buildResponse({ role, account, product });

  /*
  Franchise apne customer ka OTP verify kar raha ho to uske haath customer ka
  token nahi dena — uske paas apni franchise token already hai.

  Customer token me entry ka product bhi jaata hai: uske baad apply sirf usi
  product ka chalta hai (middleware/entryProduct.middleware.js).
  */
  return issueToken
    ? { token: generateToken(account, { product: isFranchise ? "" : product }), ...payload }
    : payload;
};

/* -------------------------------------------- customer login (phone OTP) -- */

/*
Existing customer ka login — naya account nahi banta. Sirf uska mobile OTP
verify hota hai aur login token milta hai. Ye token product-locked nahi hota:
login ke baad customer credit score check karke koi bhi loan choose kar sakta hai.
*/
const startLogin = async ({ mobile } = {}) => {
  const number = cleanText(mobile);
  if (!MOBILE_REGEX.test(number)) {
    throw badRequest("Enter a valid 10-digit mobile number");
  }

  const account = await User.findOne({ mobile: number });
  if (!account) {
    throw notFound("Customer not found. Please complete the loan entry form first.");
  }
  if (account.role === USER_ROLE.FRANCHISE) {
    throw badRequest("Franchise accounts must login with their franchise ID and password.");
  }

  const otp = freshOtp();

  // Login OTP alag purpose me — entry/status OTP ko touch nahi karta.
  await OTP.deleteMany({ mobile: number, purpose: "login" });
  await OTP.create({
    mobile: number,
    otp,
    role: USER_ROLE.CUSTOMER,
    purpose: "login",
    pendingDetails: null,
    verifiedAt: null,
  });

  const sent = await sendOTP(number, otp);
  if (!sent) throw serverError("Unable to send OTP. Please try again later.");

  return { mobile: number, mobileMasked: maskMobile(number) };
};

const verifyLogin = async ({ mobile, otp } = {}) => {
  const number = cleanText(mobile);
  const submittedOtp = cleanText(otp);

  if (!MOBILE_REGEX.test(number)) {
    throw badRequest("Enter a valid 10-digit mobile number");
  }
  if (!submittedOtp) throw badRequest("OTP is required");

  const otpData = await OTP.findOne({ mobile: number, purpose: "login" });
  if (!otpData) throw badRequest("OTP Not Found. Please request a new OTP.");
  if (String(otpData.otp) !== submittedOtp) throw badRequest("Invalid OTP");

  const account = await User.findOne({ mobile: number });
  if (!account) {
    throw notFound("Customer not found. Please complete the loan entry form first.");
  }
  if (account.role === USER_ROLE.FRANCHISE) {
    throw badRequest("Franchise accounts must login with their franchise ID and password.");
  }

  account.lastLogin = new Date();
  await account.save();

  otpData.verifiedAt = new Date();
  await otpData.save();

  // Login OTP single-use: verify hone ke baad hata do.
  await OTP.deleteMany({ mobile: number, purpose: "login" });

  const payload = buildResponse({ role: USER_ROLE.CUSTOMER, account, product: "" });

  return { token: generateToken(account, { login: true }), ...payload };
};

module.exports = {
  startEntry,
  verifyEntry,
  startLogin,
  verifyLogin,
};
