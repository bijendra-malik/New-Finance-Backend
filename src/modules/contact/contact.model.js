const mongoose = require("mongoose");

/*
==========================================
Website contact / enquiry form submissions

Website ke /contact page par "Send an enquiry" form hai (Full Name, Mobile,
Email, "I'm interested in", Message). Ye collection us form ki har entry
rakhti hai taaki admin panel se follow-up ho sake.

Do cheezein jaan-boojh kar aise hain:

1) `topic` website ke dropdown ke labels hi store karta hai (string), slug
   nahi — website aur admin panel dono ek hi label dikhate hain, aur naya
   product add hone par enum ke saath ek line badalni padti hai.

2) `handledBy`/`handledByName` denormalised hain (adminUpdates jaisa hi):
   admin delete hone par bhi record ke saath "kisne dekha tha" ka sabooot
   rehna chahiye, isliye naam copy hota hai.
==========================================
*/

/* Website ke "I'm interested in" dropdown ka wahi order + labels. */
const CONTACT_TOPICS = [
  "Personal Loan",
  "Business Loan",
  "Home Loan",
  "Loan Against Property",
  "Balance Transfer",
  "Vehicle Loan",
  "Education Loan",
  "Credit Card",
  "Project Loan",
  "Commercial Purchase",
  "Working Capital",
  "Lease Rental Discounting",
  "OD CC Limit",
  "Loan Against Share",
  "Film Funding",
  "NPA",
  "Gold Loan",
  "FDI",
  "Franchisee",
  "Other",
];

/* new → abhi tak kisi ne nahi dekha; in-progress → baat chal rahi hai; closed → done. */
const CONTACT_STATUSES = ["new", "in-progress", "closed"];

const contactEnquirySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      maxlength: [120, "Full name is too long (max 120 characters)"],
    },

    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      trim: true,
      maxlength: [20, "Mobile number is too long"],
    },

    email: {
      type: String,
      required: [true, "Email address is required"],
      trim: true,
      lowercase: true,
      maxlength: [160, "Email address is too long"],
    },

    /* Website ka "I'm interested in" — product ka naam. */
    topic: {
      type: String,
      enum: { values: CONTACT_TOPICS, message: "Unknown enquiry topic" },
      default: "Other",
    },

    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
      maxlength: [2000, "Message is too long (max 2000 characters)"],
    },

    /* Kahan se aayi — future me aur forms (application modal, franchise page) bhi bhej sakte hain. */
    source: {
      type: String,
      default: "website-contact",
      trim: true,
      maxlength: [80, "Source is too long"],
    },

    status: {
      type: String,
      enum: { values: CONTACT_STATUSES, message: "Unknown enquiry status" },
      default: "new",
    },

    /* Admin ka internal remark — customer ko nahi dikhta. */
    note: {
      type: String,
      default: "",
      trim: true,
      maxlength: [1000, "Note is too long (max 1000 characters)"],
    },

    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    handledByName: { type: String, default: "", trim: true },
    handledAt: { type: Date, default: null },

    /* Spam tracking — public endpoint hone ki wajah se IP rakhte hain. */
    ip: { type: String, default: "", maxlength: 45 },
  },
  { timestamps: true }
);

/* Admin list newest-first padhta hai, aur status filter ke saath bhi. */
contactEnquirySchema.index({ createdAt: -1 });
contactEnquirySchema.index({ status: 1, createdAt: -1 });
contactEnquirySchema.index({ email: 1 });
contactEnquirySchema.index({ mobile: 1 });

const ContactEnquiry = mongoose.model("ContactEnquiry", contactEnquirySchema);

module.exports = { ContactEnquiry, CONTACT_TOPICS, CONTACT_STATUSES };
