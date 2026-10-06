/*
==========================================
Status helpers shared by the admin endpoints (customers + loan applications)
and the shared loan service.

These live next to the shared loan engine so the admin panel and the loan
service agree on which statuses are "open" (block customer deletion) and
which transitions an admin is allowed to perform.
==========================================
*/

const { MODELS } = require("./loanModels");

/** Statuses still waiting on an admin decision. */
const OPEN_STATUSES = ["Submitted", "Pending"];

/** Statuses that close an application. */
const TERMINAL_STATUSES = ["Approved", "Rejected"];

/** Every status a loan document may carry. */
const ALL_STATUSES = [...OPEN_STATUSES, ...TERMINAL_STATUSES];

/** Admin-decisionable statuses accepted by PATCH /{resource}/:id/status. */
const SETTABLE_STATUSES = ["Pending", "Approved", "Rejected"];

/** Transition matrix — key: current status, value: statuses it may move to. */
const ALLOWED_TRANSITIONS = {
  Submitted: ["Pending", "Approved", "Rejected"],
  Pending: ["Approved", "Rejected"],
  Approved: [],
  Rejected: [],
};

/** May an application currently in `from` move to `to`? */
const canTransition = (from, to) => {
  const allowed = ALLOWED_TRANSITIONS[String(from)];
  return Array.isArray(allowed) && allowed.includes(to);
};

/*
==========================================
Applicant-facing status view.

Admins speak in raw statuses (Submitted / Pending / Approved / Rejected); the
customer dashboard wants a friendly "where is my application" stage. Both come
from the same status string, so this mapping lives next to the status rules.
==========================================
*/
const STATUS_STAGES = {
  Submitted: { stage: "Application Submitted", stageKey: "submitted", step: 1 },
  Pending: { stage: "Under Review", stageKey: "under_review", step: 2 },
  Approved: { stage: "Approved", stageKey: "approved", step: 3 },
  Rejected: { stage: "Rejected", stageKey: "rejected", step: 3 },
};

/** Raw status -> friendly stage (unknown/legacy values fall back to Submitted). */
const describeLoanStatus = (status) => STATUS_STAGES[String(status)] || STATUS_STAGES.Submitted;

/** Ordered step labels a progress bar can render. */
const STATUS_STEP_LABELS = [
  STATUS_STAGES.Submitted.stage,
  STATUS_STAGES.Pending.stage,
  STATUS_STAGES.Approved.stage,
];

module.exports = {
  OPEN_STATUSES,
  TERMINAL_STATUSES,
  ALL_STATUSES,
  SETTABLE_STATUSES,
  ALLOWED_TRANSITIONS,
  canTransition,

  STATUS_STAGES,
  STATUS_STEP_LABELS,
  describeLoanStatus,

  // Re-exported so admin modules can pull statuses + models from ONE place.
  MODELS,
};
