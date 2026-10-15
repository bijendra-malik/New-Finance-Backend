const User = require("./user.model");
const Franchise = require("../franchise/franchise.model");
const OTP = require("./otp.model");
const sendOTP = require("../../utils/sendOTP");
const generateToken = require("../../utils/generateToken");
const franchisePlanService = require("../franchise/franchisePlan.service");
const { nextCustomerId } = require("../../utils/sequence");
const { LOAN_PRODUCTS } = require("../loans/shared/loanProducts");
const { USER_ROLE, FRANCHISE_STATUS } = require("../../constants/roles");

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

const serverError = (message) => {
  const error = new Error(message);
  error.statusCode = 500;
  return error;
};

const cleanText = (value) => String(value ?? "").trim();

/** Body ko unwrap karta hai — kuch clients `{ data: { ... } }` bhejte hain. */
const unwrap = (body) =>
  body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body || {};

/** "9876543210" -> "98******10" (response me poora number wapas nahi jaata). */
const maskMobile = (mobile) => {
  const value = cleanText(mobile);
  if (value.length < 4) return value;
  return `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`;
};

/** Poori umar (saal me). */
const ageInYears = (birthDate) => {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  return age;
};

const freshOtp = () =>
  process.env.STATIC_OTP || Math.floor(100000 + Math.random() * 900000).toString();

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
  Sirf continent + country — state / city / pincode entry form me nahi hain
  (wo franchise ke business data ka hissa hain, entry ka nahi). Client bhej bhi
  de to yahan store nahi hoti.
  */
  return {
    name,
    mobile,
    email,
    dob,
    panNumber,
    continent: cleanText(payload.continent),
    country: cleanText(payload.country),
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
      franchiseStatus: FRANCHISE_STATUS.NONE,
    });
    return { account, isNew: true };
  }

  const fillIfEmpty = (field) => {
    if (!existing[field] && details[field]) existing[field] = details[field];
  };

  ["name", "email", "dob", "panNumber", "continent", "country"].forEach(fillIfEmpty);

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
        franchiseStatus: account.franchiseStatus || FRANCHISE_STATUS.NONE,
        franchiseId: account.franchiseId || null,
        isVerified: account.isVerified,
      },
    };
  }

  const config = LOAN_PRODUCTS[product];

  return {
    idType: "customer",
    customerId: account.customerId,
    product,
    loanType: config ? config.loanType : "",
    nextStep: "loan-apply",
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

  // Ek mobile ka ek hi live OTP — naya entry purane wale ko replace karta hai.
  await OTP.deleteMany({ mobile: details.mobile });

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

  const otpData = await OTP.findOne({ mobile: verifiedMobile });

  if (!otpData) throw badRequest("OTP Not Found");
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
      await OTP.deleteMany({ mobile: verifiedMobile });
      throw badRequest("Account not found. Please request a new OTP.");
    }

    const payload = buildResponse({ role, account, product });
    return issueToken ? { token: generateToken(account), ...payload } : payload;
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
    await OTP.deleteMany({ mobile: verifiedMobile });
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
  */
  return issueToken ? { token: generateToken(account), ...payload } : payload;
};

module.exports = {
  startEntry,
  verifyEntry,
};
