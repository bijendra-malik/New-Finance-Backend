/*
==========================================
Eligibility engine — family dispatcher

Website ke EligibilityCalculatorPage ke computeOutcome() ka 1:1 port:
product.family dekh kar wahi family engine chalta hai aur wahi fields
bheje jaate hain. Inputs flat FormState keys me aate hain (numbers).
==========================================
*/

const { maxTenureFor } = require("./core");
const { termEligibility } = require("./term");
const { goldEligibility } = require("./gold");
const { educationEligibility } = require("./education");
const { projectEligibility } = require("./project");
const { commercialEligibility } = require("./commercial");
const { turnoverEligibility } = require("./turnover");
const { workingCapitalEligibility } = require("./workingCapital");
const { lrdEligibility, LRD_ROI, LRD_TENURE_YEARS, formulaFor } = require("./lrd");
const { shareEligibility } = require("./shares");

const evaluate = (product, inputs) => {
  const age = inputs.age;
  const occupation = inputs.occupation;
  const tenure = maxTenureFor(product, age, occupation);

  if (product.family === "lrd") {
    return lrdEligibility({
      product,
      roi: LRD_ROI,
      monthlyRent: inputs.lrdRent,
      leaseMonths: Math.round(inputs.lrdLeaseYears * 12),
      propertyValue: inputs.lrdPropertyValue,
      repaymentMonths: LRD_TENURE_YEARS * 12,
      ltvPercent: inputs.lrdLtv,
      deductionPct: inputs.lrdDeduction,
      coveragePct: inputs.lrdCoverage,
      creditScore: inputs.creditScore,
    });
  }

  if (product.family === "education") {
    return educationEligibility({
      product,
      months: tenure,
      courseFees: inputs.eduFees,
      hostelCost: inputs.eduHostel,
      otherCost: inputs.eduOther,
      scholarships: inputs.eduScholarship,
      marginMoney: inputs.eduMargin,
      coApplicantIncome: inputs.monthlyIncome,
      existingEmi: inputs.existingEmi,
      creditScore: inputs.creditScore,
    });
  }

  if (product.family === "project") {
    return projectEligibility({
      product,
      months: tenure,
      projectCost: inputs.projectCost,
      promoterContribution: inputs.projectContribution,
      monthlyCashFlow: inputs.projectCashFlow,
      dscr: inputs.projectDscr,
      creditScore: inputs.creditScore,
    });
  }

  if (product.family === "commercial") {
    return commercialEligibility({
      product,
      months: tenure,
      propertyValue: inputs.propertyValue,
      monthlyRent: inputs.commercialRent,
      monthlyIncome: inputs.monthlyIncome,
      existingEmi: inputs.existingEmi,
      coApplicantIncome: inputs.commercialCoApplicant,
      ltvPct: inputs.commercialLtv,
      creditScore: inputs.creditScore,
    });
  }

  if (product.family === "turnover") {
    return turnoverEligibility({
      product,
      turnover: inputs.turnover,
      assessmentPct: inputs.wcAssessment,
      margin: inputs.wcMargin,
      currentAssets: inputs.wcCurrentAssets,
      currentLiabilities: inputs.wcCurrentLiabilities,
      mode: inputs.wcMethod,
      creditScore: inputs.creditScore,
    });
  }

  if (product.family === "gold") {
    return goldEligibility({
      product,
      grams: inputs.goldGrams,
      ratePerGram: inputs.goldRate,
      months: tenure,
      monthlyIncome: inputs.monthlyIncome,
      existingEmi: inputs.existingEmi,
      creditScore: inputs.creditScore,
    });
  }

  if (product.family === "wc") {
    return workingCapitalEligibility({
      product,
      turnover: inputs.turnover,
      stock: inputs.stock,
      debtors: inputs.debtors,
      otherCurrentLiabilities: inputs.otherCurrentLiabilities,
      margin: inputs.odMargin,
      mode: inputs.odMode,
      creditScore: inputs.creditScore,
    });
  }

  if (product.family === "share") {
    return shareEligibility({
      product,
      marketValue: inputs.shareValue,
      monthlyIncome: inputs.monthlyIncome,
      existingEmi: inputs.existingEmi,
      months: tenure,
      creditScore: inputs.creditScore,
    });
  }

  const asset = product.asset;
  return termEligibility({
    product,
    monthlyIncome: inputs.monthlyIncome,
    existingEmi: inputs.existingEmi,
    age,
    occupation,
    tenureMonths: tenure,
    assetValue: asset ? inputs[asset.field] : 0,
    downPayment: inputs.vehicleDownPayment,
    ltvPct: inputs.vehicleLtv,
    assetType: product.key === "lap" ? inputs.lapAssetType : undefined,
    cityCategory: product.key === "lap" ? inputs.lapCity : undefined,
    existingLoanOnAsset: product.key === "lap" ? inputs.lapExistingLoan : 0,
    rentalIncome: product.key === "lap" && inputs.lapUsage === "Rented out" ? inputs.lapRent : 0,
    creditScore: inputs.creditScore,
  });
};

module.exports = { evaluate, formulaFor };
