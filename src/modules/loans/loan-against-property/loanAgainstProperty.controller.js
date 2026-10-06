const loanAgainstPropertyService = require("./loanAgainstProperty.service");

module.exports = {
  apply: async (req, res, next) => {
    try {
      // Snapshot the resolved FDP location onto the application document.
      req.body = req.body ?? {};
      if (req.fdpLocation) {
        req.body.collateralPropertyStateId = req.fdpLocation.stateId;
        req.body.collateralPropertyCityId = req.fdpLocation.cityId;
        req.body.collateralPropertyPincode = req.fdpLocation.pincode;
      }
      return loanAgainstPropertyService.apply(req, res, next);
    } catch (error) {
      next(error);
    }
  },
  list: loanAgainstPropertyService.list,

  // Used by the admin application controller.
  sanitizeLoanAgainstPropertyResponse: loanAgainstPropertyService.sanitize,

  // Resolves the FDP location chain and stamps it on the request before the
  // shared engine runs.
};
