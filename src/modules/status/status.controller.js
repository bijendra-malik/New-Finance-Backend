const statusService = require("./status.service");

/*
==========================================
Customer status door (public — koi token nahi).

  POST /api/status/request-otp   identity (CUST id + PAN) -> registered mobile par OTP
  POST /api/status               OTP verify -> application ka status + process

Dono step ek hi identity check par khade hai, isliye response me kabhi poora mobile
number wapas nahi jaata (sirf masked).
==========================================
*/

/* POST /api/status/request-otp */
exports.requestOtp = async (req, res, next) => {
  try {
    const { customerId, panNumber, mobile } = req.body ?? {};
    const result = await statusService.requestStatusOtp({ customerId, panNumber, mobile });

    res.json({
      success: true,
      message: result.message,
      mobileMasked: result.mobileMasked,
      nextStep: "status",
    });
  } catch (error) {
    next(error);
  }
};

/* POST /api/status */
exports.status = async (req, res, next) => {
  try {
    const { customerId, panNumber, otp } = req.body ?? {};
    const result = await statusService.getApplicationStatus({ customerId, panNumber, otp });

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};
