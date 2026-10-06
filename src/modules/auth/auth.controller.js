const User = require("./user.model");
const OTP = require("./otp.model");
const generateToken = require("../../utils/generateToken");
const sendOTP = require("../../utils/sendOTP");
const { USER_ROLE, FRANCHISE_STATUS } = require("../../constants/roles");
const {
  FRANCHISE_PROFILE_FIELDS,
  sanitizeFranchiseProfile,
} = require("../franchise/franchiseProfile");

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

/*
==========================================
Register User & Send OTP
POST /api/auth/register

ONE endpoint for both account types. The body carries `role`
("Customer" | "Franchise") plus the registration fields:

  { role, continent, country, name, mobile, email }

The role + location are stored on the account so the JWT (minted after OTP)
already knows who the caller is. A second family of fields (PAN, state, city,
package, ...) is collected later from the franchise application form.
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

    const user = await User.findOne({ mobile });

    if (user && user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "User already registered. Please login instead.",
      });
    }

    const otp = process.env.STATIC_OTP || Math.floor(100000 + Math.random() * 900000).toString();

    // Remove old OTP
    await OTP.deleteMany({ mobile });

    // Save OTP
    await OTP.create({
      mobile,
      otp,
      expiresAt: new Date(Date.now() + (process.env.OTP_EXPIRE_MINUTES || 5) * 60 * 1000),
    });

    // Create or reuse the (still unverified) account.
    if (!user) {
      await User.create({
        name,
        mobile,
        email,
        role: accountRole,
        continent: continent || "",
        country: country || "",
        isVerified: false,
      });
    } else {
      // Re-registration before OTP: refresh the details the applicant just typed.
      user.name = name;
      user.email = email;
      user.role = accountRole;
      if (continent !== undefined) user.continent = continent;
      if (country !== undefined) user.country = country;
      await user.save();
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
      message: user ? "OTP resent for verification" : "OTP sent successfully",
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

    const user = await User.findOne({ mobile });

    user.isVerified = true;

    await user.save();

    await OTP.deleteMany({ mobile });

    const token = generateToken(user);

    res.json({
      success: true,
      message: "Mobile Verified Successfully",
      token,
      user: authUserResponse(user),
      // Tells the frontend where to route next:
      //   Customer            -> customer dashboard
      //   Franchise (None)    -> franchise application form
      //   Franchise (Pending) -> waiting-for-approval screen
      //   Franchise (Approved)-> franchise dashboard
      nextStep: nextStepFor(user),
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

    const user = await User.findOne({ mobile });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this mobile number. Please register first.",
      });
    }

    if (!user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Account not verified. Please complete registration OTP verification first.",
      });
    }

    const otp = process.env.STATIC_OTP || Math.floor(100000 + Math.random() * 900000).toString();

    await OTP.deleteMany({ mobile });

    await OTP.create({
      mobile,
      otp,
      expiresAt: new Date(Date.now() + (process.env.OTP_EXPIRE_MINUTES || 5) * 60 * 1000),
    });

    const otpSent = await sendOTP(mobile, otp);
    if (!otpSent) {
      return res.status(500).json({
        success: false,
        message: "Unable to send OTP. Please try again later.",
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

    const user = await User.findOne({ mobile });

    user.isVerified = true;
    user.lastLogin = new Date();

    await user.save();

    await OTP.deleteMany({ mobile });

    const token = generateToken(user);

    res.json({
      success: true,
      token,
      user: authUserResponse(user),
      nextStep: nextStepFor(user),
    });
  } catch (error) {
    next(error);
  }
};

/*
==========================================
Profile
GET /api/auth/profile
==========================================
*/

exports.profile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

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
    const user = await User.findById(req.user.id);

    res.json({
      success: true,
      user: sanitizeFranchiseProfile(user),
    });
  } catch (error) {
    next(error);
  }
};

/* Routes the client should open next, based on role + franchise status. */
const nextStepFor = (user) => {
  if (user.role !== USER_ROLE.FRANCHISE) return "customer-dashboard";

  if (user.franchiseStatus === FRANCHISE_STATUS.APPROVED) return "franchise-dashboard";
  if (user.franchiseStatus === FRANCHISE_STATUS.PENDING) return "franchise-pending";
  if (user.franchiseStatus === FRANCHISE_STATUS.REJECTED) return "franchise-rejected";
  return "franchise-apply";
};
