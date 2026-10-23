const mongoose = require("mongoose");

const FranchiseCustomer = require("../modules/franchise/franchiseCustomer.model");

/*
==========================================
Franchise customer loan apply — profile merge.

Franchise apne customer ke liye loan apply karta hai, aur applicant ki identity
(fullName / mobile / PAN / DOB / email) pehle se `franchisecustomers` record me
hoti hai. Form inhe dobara nahi bhejta — isliye validation se PEHLE profile ki
values body me bhar di jaati hain, warna product ke personal-detail rules
"Full name is required" jaisa 400 de dete hain.

Service (`franchise.service.js` -> `createFranchiseLoanDraft`) bhi yahi values profile
se leti hai, isliye yahan client ki bheji identity overwrite hona hi sahi hai.

Address (state / city / pincode) form ki value pehle rakhta hai aur khaali hone
par profile se bharta hai — bilkul service ke `applicantFromCustomer` jaisa.
==========================================
*/

const ADDRESS_FIELDS = ["state", "city", "pincode"];

const forbidden = (res, message) => res.status(403).json({ success: false, message });

module.exports = async (req, res, next) => {
  try {
    const id = String(req.body?.franchiseCustomerId ?? "").trim();

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message:
          "franchiseCustomerId is required. Register the customer at POST /api/franchise/customer/register first.",
      });
    }

    // Franchise-scoped: doosri franchise ka customer yahan nahi milega.
    const customer = await FranchiseCustomer.findOne({ _id: id, franchise: req.franchise._id });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    if (!customer.isVerified) {
      return forbidden(
        res,
        "This customer's mobile is not verified yet. Send the OTP and verify the customer before applying for a loan."
      );
    }

    // Identity is SERVER-owned in this flow — always the registered profile.
    req.body.fullName = customer.fullName;
    req.body.mobile = customer.mobile;
    req.body.panNumber = customer.panNumber;
    req.body.dob = customer.dob ? new Date(customer.dob).toISOString().slice(0, 10) : "";
    if (String(customer.email ?? "").trim()) req.body.email = customer.email;

    // Address: form value pehle, profile fallback jab form me khaali ho.
    ADDRESS_FIELDS.forEach((field) => {
      const sent = String(req.body[field] ?? "").trim();
      const saved = String(customer[field] ?? "").trim();
      if (!sent && saved) req.body[field] = saved;
    });

    req.franchiseCustomer = customer;

    return next();
  } catch (error) {
    return next(error);
  }
};
