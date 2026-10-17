const jwt = require("jsonwebtoken");

const generateToken = (user, { product = "", login = false } = {}) => {

    return jwt.sign(
        {
            id: user._id,
            mobile: user.mobile,
            role: user.role,
            // Franchise tokens carry the minted FRN code so franchise endpoints
            // never have to re-read it from the client body.
            franchiseId: user.franchiseId || null,
            // Customer entry (`POST /api/auth/:product`) ka loan product. Apply
            // sirf isi product ka chalta hai —
            // middleware/entryProduct.middleware.js.
            ...(product ? { product } : {}),
            // Login token (`POST /api/auth/login/verify-otp`) kisi ek product
            // se bandha nahi hota — customer credit score check ke baad koi
            // bhi loan choose kar sakta hai.
            ...(login ? { login: true } : {}),
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "7d"
        }
    );

};

module.exports = generateToken;
