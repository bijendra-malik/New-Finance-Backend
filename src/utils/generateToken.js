const jwt = require("jsonwebtoken");

const generateToken = (user) => {

    return jwt.sign(
        {
            id: user._id,
            mobile: user.mobile,
            role: user.role,
            // Franchise tokens carry the minted FRN code so franchise endpoints
            // never have to re-read it from the client body.
            franchiseId: user.franchiseId || null
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "7d"
        }
    );

};

module.exports = generateToken;
