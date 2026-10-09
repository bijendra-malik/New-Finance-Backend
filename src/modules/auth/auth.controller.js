const User = require("./user.model");
const Franchise = require("../franchise/franchise.model");
const OTP = require("./otp.model");
const generateToken = require("../../utils/generateToken");
const sendOTP = require("../../utils/sendOTP");
const { USER_ROLE, FRANCHISE_STATUS } = require("../../constants/roles");
const {
  FRANCHISE_PROFILE_FIELDS,
  sanitizeFranchiseProfile,
} = require("../franchise/franchiseProfile");

/*
==========================================
Auth controller — role aware.

Do collections hain:
  users       -> Customer (legacy \"User\" bhi)
  franchises  -> Franchise partner (apni collection, apne fields)

Register me `role` body se aata hai, isliye account seedha sahi collection me
banta hai. OTP document par bhi wahi role likh diya jaata hai, taaki
verify-otp/login-verify ko guess na karna pade. Purane OTP records (jisme role
nahi hai) ke liye `findAccountForMobile` dono collections me dekhta hai.
==========================================
*/

const isFranchiseRole = (role) => role === USER_ROLE.FRANCHISE;

/** Role -> us collection ka model. */
const modelForRole = (role) => (isFranchiseRole(role) ? Franchise : User);

/** Ulta model — duplicate mobile/email pakadne ke liye. */
const otherModelFor = (Model) => (Model === Franchise ? User : Franchise);

const roleLabel = (Model) => (Model === Franchise ? "franchise" : "customer");

const authUserResponse = (user) => ({
  _id: user._id,
  name: user.name,
  mobile: user.mobile,
  email: user.email,
  isVerified: user.isVerified,
  role: user.role,
  continent: user.continent,
  country: user.country,
  isActive: user.isActive,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

/**
 * Mobile se account dhoondhta hai — pehle role hint se, warna dono collections me.
 * Reply me `{ account, Model }` aata hai taaki token/model usi ke saath bane.
 */
const findAccountForMobile = async (mobile, roleHint = "") => {
  if (roleHint) {
    const account = await modelForRole(roleHint).findOne({ mobile });
    if (account) return { account, Model: modelForRole(roleHint) };
  }

  /*
  Role hint nahi hai (login / purana OTP) — to `franchises` PEHLE dekho.

  Kyun: migration se pehle ke franchise documents `users` collection me pade ho
  sakte hain. Pehle `users` dekhne par wahi purana (unverified) doc mil jaata tha
  aur asli franchise kabhi check hi nahi hoti thi — login "Account not verified"
  de deta tha. Naye franchise accounts hamesha `franchises` me bante hain, isliye
  franchise-first order sahi hai; koi asli customer `franchises` me nahi hota.
  */
  const franchise = await Franchise.findOne({ mobile });
  if (franchise) return { account: franchise, Model: Franchise };

  const customer = await User.findOne({ mobile });
  if (customer) return { account: customer, Model: User };

  return { account: null, Model: null };
};

/**
 * Ek mobile/email dono jagah register nahi ho sakta: login mobile se hota hai,
 * to duplicate rakhne par "kaun sa account" ka sawaal aa jaata hai.
 */
const conflictInOtherCollection = async (Model, { mobile, email }) => {
  const Other = otherModelFor(Model);

  /*
  Jab doosri collection `users` hai (yaani franchise register ho rahi hai) to
  usme pade PURANE franchise documents ko ignore karo. Warna migration se pehle
  ka ek leftover doc franchise registration ko galat "already registered as a
  customer" message ke saath block kar deta tha.
  Customer registration par ye filter lagta hi nahi (Other = franchises), isliye
  asli franchise ke mobile par customer banne ka guard jaisa tha waisa rehta hai.
  */
  const notLegacyFranchise = Other === User ? { role: { $ne: USER_ROLE.FRANCHISE } } : {};

  const sameMobile = await Other.findOne({ mobile, ...notLegacyFranchise });
  if (sameMobile) {
    return `This mobile is already registered as a ${roleLabel(Other)}. Please use another mobile number or login instead.`;
  }

  if (email) {
    const sameEmail = await Other.findOne({ email: String(email).toLowerCase(), ...notLegacyFranchise });
    if (sameEmail) {
      return `This email is already registered as a ${roleLabel(Other)}. Please use another email address.`;
    }
  }

  return null;
};

/*
==========================================
Register User & Send OTP
POST /api/auth/register

ONE endpoint for both account types — `role` decides the collection:

  { role, continent, country, name, mobile, email }

Role + location account par store hote hain, isliye OTP ke baad banne wala JWT
already jaanta hai caller kaun hai. Franchise-specific fields (PAN, state, city,
package, ...) baad me /api/franchise/apply se aate hain.
==========================================
*/

exports.register = async (req, res, next) => {
  try {
    const { name, mobile, email, role, continent, country } = req.body;

    if (!name || !mobile || !email) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const accountRole = role || USER_ROLE.CUSTOMER;
    const Model = modelForRole(accountRole);

    // Franchise aur customer ka mobile overlap na ho — warna login ambiguous ho
    // jaata hai (aur franchise ke naam par customer loan ka risk banta hai).
    const conflict = await conflictInOtherCollection(Model, { mobile, email });
    if (conflict) {
      return res.status(400).json({ success: false, message: conflict });
    }

    const account = await Model.findOne({ mobile });

    if (account && account.isVerified) {
      return res.status(400).json({
        success: false,
        message: isFranchiseRole(accountRole)
          ? "Franchise already registered. Please login instead."
          : "User already registered. Please login instead.",
      });
    }

    const otp = process.env.STATIC_OTP || Math.floor(100000 + Math.random() * 900000).toString();

    // Remove old OTP
    await OTP.deleteMany({ mobile });

    // Save OTP (role ke saath — verify isi se collection chunta hai)
    await OTP.create({
      mobile,
      otp,
      role: accountRole,
      expiresAt: new Date(Date.now() + (process.env.OTP_EXPIRE_MINUTES || 5) * 60 * 1000),
    });

    // Create or reuse the (still unverified) account in ITS OWN collection.
    if (!account) {
      await Model.create({
        name,
        mobile,
        email,
        ...(isFranchiseRole(accountRole) ? {} : { role: accountRole }),
        continent: continent || "",
        country: country || "",
        isVerified: false,
      });
    } else {
      // Re-registration before OTP: refresh the details the applicant just typed.
      account.name = name;
      account.email = email;
      if (!isFranchiseRole(accountRole)) account.role = accountRole;
      if (continent !== undefined) account.continent = continent;
      if (country !== undefined) account.country = country;
      await account.save();
    }

    const otpSent = await sendOTP(mobile, otp);
    if (!otpSent) {
      return res.status(500).json({
        success: false,
        message: "Unable to send OTP. Please try again later.",
      });
    }

    res.status(200).json({
      success: true,
      message: account ? "OTP resent for verification" : "OTP sent successfully",
    });
  } catch (error) {
    next(error);
  }
};

/*
==========================================
Verify OTP
POST /api/auth/verify-otp

Verifying the mobile both marks the account verified AND returns the JWT.
The token carries { id, mobile, role, franchiseId }, so every later endpoint
identifies the caller without trusting client-sent name/mobile.
==========================================
*/

exports.verifyOTP = async (req, res, next) => {
  try {
    const { mobile, otp } = req.body;

    const otpData = await OTP.findOne({ mobile });

    if (!otpData) {
      return res.status(400).json({
        success: false,
        message: "OTP Not Found",
      });
    }

    if (otpData.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP Expired",
      });
    }

    if (otpData.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const { account } = await findAccountForMobile(mobile, otpData.role);

    if (!account) {
      return res.status(400).json({
        success: false,
        message: "Account not found. Please register first.",
      });
    }

    account.isVerified = true;

    await account.save();

    await OTP.deleteMany({ mobile });

    const token = generateToken(account);

    res.json({
      success: true,
      message: "Mobile Verified Successfully",
      token,
      user: authUserResponse(account),
      // Tells the frontend where to route next:
      //   Customer            -> customer dashboard
      //   Franchise (None)    -> franchise application form
      //   Franchise (Pending) -> waiting-for-approval screen
      //   Franchise (Approved)-> franchise dashboard
      nextStep: nextStepFor(account),
    });
  } catch (error) {
    next(error);
  }
};

/*
==========================================
Login
POST /api/auth/login
==========================================
*/

exports.login = async (req, res, next) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required",
      });
    }

    const { account } = await findAccountForMobile(mobile);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "No account found with this mobile number. Please register first.",
      });
    }

    const otp = process.env.STATIC_OTP || Math.floor(100000 + Math.random() * 900000).toString();

    await OTP.deleteMany({ mobile });

    await OTP.create({
      mobile,
      otp,
      role: account.role || USER_ROLE.CUSTOMER,
      expiresAt: new Date(Date.now() + (process.env.OTP_EXPIRE_MINUTES || 5) * 60 * 1000),
    });

    const otpSent = await sendOTP(mobile, otp);
    if (!otpSent) {
      return res.status(500).json({
        success: false,
        message: "Unable to send OTP. Please try again later.",
      });
    }

    /*
    Register ke baad OTP verification adhoora reh gaya (ya OTP 5 min me expire
    ho gaya). Pehle login yahan 400 "Account not verified" dekar dead-end ban
    jaata tha, isliye user register hone ke baad bhi login nahi kar paata tha.
    Ab wahi verification OTP dobara bhej diya jaata hai — client ise verify-otp /
    login-verify se complete karke aage badh sakta hai.
    */
    if (!account.isVerified) {
      return res.json({
        success: true,
        needsVerification: true,
        message:
          "Account is not verified yet. A fresh OTP has been sent — please verify your mobile number to continue.",
      });
    }

    res.json({
      success: true,
      message: "Login OTP sent successfully",
    });
  } catch (error) {
    next(error);
  }
};

/*
==========================================
Verify Login OTP
POST /api/auth/login/verify
==========================================
*/

exports.verifyLoginOTP = async (req, res, next) => {
  try {
    const { mobile, otp } = req.body;

    const otpData = await OTP.findOne({ mobile });

    if (!otpData) {
      return res.status(400).json({
        success: false,
        message: "OTP Not Found",
      });
    }

    if (otpData.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP Expired",
      });
    }

    if (otpData.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const { account } = await findAccountForMobile(mobile, otpData.role);

    if (!account) {
      return res.status(400).json({
        success: false,
        message: "Account not found. Please register first.",
      });
    }

    account.isVerified = true;
    account.lastLogin = new Date();

    await account.save();

    await OTP.deleteMany({ mobile });

    const token = generateToken(account);

    res.json({
      success: true,
      token,
      user: authUserResponse(account),
      nextStep: nextStepFor(account),
    });
  } catch (error) {
    next(error);
  }
};

/*
==========================================
Profile
GET /api/auth/profile  (token ke role se sahi collection)
==========================================
*/

exports.profile = async (req, res, next) => {
  try {
    const Model = modelForRole(req.user?.role);
    const user = await Model.findById(req.user.id);

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

exports.customerProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const customer = user ? user.toObject() : null;

    if (customer) {
      FRANCHISE_PROFILE_FIELDS.forEach((field) => delete customer[field]);
      if (customer.role === USER_ROLE.LEGACY_CUSTOMER) {
        customer.role = USER_ROLE.CUSTOMER;
      }
    }

    res.json({
      success: true,
      user: customer,
    });
  } catch (error) {
    next(error);
  }
};

exports.franchiseProfile = async (req, res, next) => {
  try {
    const franchise = await Franchise.findById(req.user.id);

    res.json({
      success: true,
      user: sanitizeFranchiseProfile(franchise),
    });
  } catch (error) {
    next(error);
  }
};

/* Routes the client should open next, based on role + franchise status. */
const nextStepFor = (account) => {
  if (account.role !== USER_ROLE.FRANCHISE) return "customer-dashboard";

  if (account.franchiseStatus === FRANCHISE_STATUS.APPROVED) return "franchise-dashboard";
  if (account.franchiseStatus === FRANCHISE_STATUS.PENDING) return "franchise-pending";
  if (account.franchiseStatus === FRANCHISE_STATUS.REJECTED) return "franchise-rejected";
  return "franchise-apply";
};
