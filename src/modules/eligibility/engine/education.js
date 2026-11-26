/* Education loans — 1:1 port of eligibility/models/education.ts. */

const {
  EDUCATION_FOIR_CAP,
  MIN_LOAN,
  creditRefusal,
  emiForPrincipal,
  holding,
  money,
  principalForEmi,
  roundTo,
  tenureText,
} = require("./core");

const educationEligibility = (input) => {
  const { product } = input;

  const refusal = creditRefusal(input.creditScore, "Indicative education loan");
  if (refusal) return refusal;

  const roi =
    input.roi !== undefined && Number.isFinite(input.roi) && input.roi >= 0 ? input.roi : product.roi;
  const months = Math.min(product.maxTenureMonths, Math.max(0, Math.round(input.months)));
  const fees = Math.max(0, input.courseFees);
  const hostel = Math.max(0, input.hostelCost);
  const other = Math.max(0, input.otherCost);
  const scholarships = Math.max(0, input.scholarships);
  const margin = Math.max(0, input.marginMoney);
  const cost = fees + hostel + other;

  if (cost <= 0) {
    return holding(
      "Indicative education loan",
      "Add the course fees for the programme, and any hostel or other eligible costs, and we will work out what can be borrowed.",
      [
        "Tuition, hostel and living costs count when they are part of the course.",
        "Scholarships and the margin your family funds are deducted before the loan is worked out.",
      ],
      "EDU_COST_MISSING",
    );
  }

  if (months <= 0) {
    return holding(
      "Indicative education loan",
      "There is no repayment tenure left for this applicant.",
      ["Lenders need the loan repaid within the tenure they allow for education loans."],
      "TENURE_NONE",
    );
  }

  const claim = Math.max(0, cost - scholarships);
  const value = roundTo(Math.max(0, claim - margin), 1000);

  const income = Math.max(0, input.coApplicantIncome || 0);
  const existing = Math.max(0, input.existingEmi || 0);
  const headroom = income > 0 ? Math.max(0, income * EDUCATION_FOIR_CAP - existing) : 0;
  const capacity = income > 0 ? roundTo(principalForEmi(headroom, roi, months), 1000) : 0;

  const caps = [{ key: "cost", label: "Course cost less scholarships and margin", value }];
  if (income > 0) {
    caps.unshift({ key: "foir", label: "Repayment capacity", value: capacity });
  }

  if (value < MIN_LOAN) {
    return Object.assign(
      holding(
        "Indicative education loan",
        `Scholarships and margin cover most of this ${money(cost)} cost, leaving less than the ${money(MIN_LOAN)} most lenders will sanction.`,
        ["A larger loan can still be arranged against a longer course or additional eligible expenses."],
        "BELOW_MIN_LOAN",
      ),
      { roi, months },
    );
  }

  if (income > 0 && capacity < MIN_LOAN) {
    return Object.assign(
      holding(
        "Indicative education loan",
        existing > 0
          ? `The co-applicant's existing EMIs of ${money(existing)} use up the income lenders will count, leaving no room for a new education loan.`
          : `The co-applicant's ${money(income)} income leaves too little EMI room for the ${money(MIN_LOAN)} most lenders will sanction over ${tenureText(months)}.`,
        [
          "Closing or part-pre-paying an existing loan frees up EMI headroom.",
          "A longer repayment tenure after the moratorium lowers the EMI and raises the limit.",
        ],
        "CO_APPLICANT_CAPACITY_LOW",
      ),
      {
        caps,
        binding: "Repayment capacity",
        roi,
        months,
        foir: {
          used: income > 0 ? (existing + emiForPrincipal(capacity, roi, months)) / income : 0,
          headroom,
          income,
          existing,
        },
      },
    );
  }

  const loan = Math.min(...caps.map((cap) => cap.value));
  const binding = caps.reduce((lowest, cap) => (cap.value < lowest.value ? cap : lowest)).label;
  const emi = emiForPrincipal(loan, roi, months);

  return {
    eligible: true,
    headline: loan,
    headlineLabel: "Indicative education loan",
    monthly: Math.round(emi),
    monthlyLabel: "Monthly EMI",
    roi,
    months,
    caps,
    binding,
    foir: income > 0
      ? {
          used: (existing + emi) / income,
          headroom: Math.max(0, income * EDUCATION_FOIR_CAP - existing - emi),
          income,
          existing,
        }
      : null,
    message: income > 0
      ? `A ${money(cost)} course less ${money(scholarships)} of scholarships and ${money(margin)} of margin leaves ${money(value)}; the co-applicant's income supports ${money(capacity)}, so the estimate is ${money(loan)}, repayable over ${tenureText(months)}.`
      : `A course costing ${money(cost)} less ${money(scholarships)} of scholarships and ${money(margin)} of margin supports about ${money(loan)}, repayable over ${tenureText(months)}.`,
    suggestions: [],
    reasonCode: null,
  };
};

module.exports = { educationEligibility };
