require("./config/env");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const app = express();

/* ============================
   Middlewares
============================ */
app.use(helmet());

// Explicit origin allowlist — never leave this as bare cors() in a project
// handling financial/PII data (see SECURITY-PLAN.md §3).
const allowedOrigins = [process.env.FRONTEND_URL, process.env.ADMIN_URL].filter(Boolean);

app.use(
    cors({
        origin: allowedOrigins.length ? allowedOrigins : true,
        credentials: true,
    })
);

app.use(express.json({ limit: "1mb" }));

app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(morgan("dev"));

/* ============================
   Health Check
============================ */
app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Indexia Finance Backend Running"
    });
});

/* ============================
   Routes
============================ */

app.use("/api/auth", require("./modules/auth/auth.routes"));

app.use("/api/franchise", require("./modules/franchise/franchise.routes"));

app.use("/api/customer", require("./modules/customer/customer.routes"));

app.use("/api/personal-loan", require("./modules/loans/personal-loan/personalLoan.routes"));
app.use("/api/business-loan", require("./modules/loans/business-loan/businessLoan.routes"));
app.use("/api/home-loan", require("./modules/loans/home-loan/homeLoan.routes"));
app.use("/api/commercial-purchase", require("./modules/loans/commercial-purchase/commercialPurchase.routes"));
app.use("/api/loan-against-property", require("./modules/loans/loan-against-property/loanAgainstProperty.routes"));
app.use("/api/working-capital", require("./modules/loans/working-capital/workingCapital.routes"));
app.use("/api/od-cc-limit", require("./modules/loans/od-cc-limit/odCcLimit.routes"));
app.use("/api/lease-rental-discounting", require("./modules/loans/lease-rental-discounting/leaseRentalDiscounting.routes"));
app.use("/api/film-funding", require("./modules/loans/film-funding/filmFunding.routes"));
app.use("/api/fdi-loan", require("./modules/loans/fdi-loan/fdiLoan.routes"));
app.use("/api/npa-loan", require("./modules/loans/npa-loan/npaLoan.routes"));
app.use("/api/gold-loan", require("./modules/loans/gold-loan/goldLoan.routes"));
app.use("/api/loan-against-share", require("./modules/loans/loan-against-share/loanAgainstShare.routes"));
app.use("/api/balance-transfer", require("./modules/loans/balance-transfer/balanceTransfer.routes"));
app.use("/api/project-loan", require("./modules/loans/project-loan/projectLoan.routes"));
app.use("/api/vehicle-loan", require("./modules/loans/vehicle-loan/vehicleLoan.routes"));
app.use("/api/education-loan", require("./modules/loans/education-loan/educationLoan.routes"));
app.use("/api/credit-card", require("./modules/loans/credit-card/creditCard.routes"));

app.use("/api/masters", require("./modules/masters/master.routes"));
app.use("/api/employment-types", require("./modules/masters/employmentType.routes"));

app.use("/api/admin", require("./modules/admin"));

/* ============================
   Error Handler
============================ */

app.use(require("./middleware/error.middleware"));

module.exports = app;
