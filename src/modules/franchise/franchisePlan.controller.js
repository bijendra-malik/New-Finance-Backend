const jwt = require("jsonwebtoken");

const franchisePlanService = require("./franchisePlan.service");
const Franchise = require("./franchise.model");
const { USER_ROLE } = require("../../constants/roles");

/*
==========================================
Franchise plans — public read.

Frontend ke /franchise page ka "Plans & fees" section isi se banta hai.
Login zaroori nahi: ye published price list hai, koi personal data nahi.
Isliye "Apply for a Franchise" se pehle wala visitor bhi plans dekh sakta hai.
==========================================
*/

/*
Bheje hue franchise token se uska chuna hua plan nikalna (UI ka "Selected ✓").

Ye endpoint PUBLIC hai, isliye token galat/expired ho to 401 dena galat hoga —
chup-chaap ignore kar dete hain aur `selectedPlanCode: null` bhej dete hain.
*/
const selectedPlanCodeFromRequest = async (req) => {
  const header = req.headers.authorization;
  if (!header) return null;

  try {
    const token = header.split(" ")[1];
    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || decoded.role !== USER_ROLE.FRANCHISE) return null;

    // `plan.code` snapshot se aata hai — admin baad me plan rename kare to bhi
    // franchise ka chuna hua plan wahi rehta hai.
    const franchise = await Franchise.findById(decoded.id).select("plan package");
    return franchise?.plan?.code || null;
  } catch (error) {
    return null;
  }
};

/*
List Franchise Plans (public)
GET /api/franchise/plans
*/
exports.list = async (req, res, next) => {
  try {
    const { plans, bestValueCode, bestValueIsPinned } =
      await franchisePlanService.listPublicPlans();

    res.json({
      success: true,
      count: plans.length,
      // UI ka "Best Value" badge — admin ne pin kiya ho to wahi, warna sabse
      // kam effective monthly cost wala plan.
      bestValueCode,
      bestValueIsPinned,
      selectedPlanCode: await selectedPlanCodeFromRequest(req),
      plans,
    });
  } catch (error) {
    next(error);
  }
};
