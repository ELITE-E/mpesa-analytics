// Copy for the Analysis Complete & Limitations screen, taken from the Stitch
// HTML (stitch-export/analysis-complete/analysis-complete.html). Figures now
// come from the API; copy for figures the analytics do not produce (SHA-256
// hash, retained %, inflow sources, excluded amounts) was removed.

export const hero = {
  statusLabel: "Analysis complete • This session only",
  verificationLabel: "Verification code",
  title: "Your Analysis is Ready",
};

/** The statement checks card (CP8b item 5): never "verified" or "genuine" (ADR-free copy rule). */
export const checks = {
  title: "Statement checks",
  verificationLabel: "Verification code",
  verifyWithSafaricom: "Verify with Safaricom",
  // Shown when the core could not read the statement's own instruction: the app never assumes a code.
  instructionUnreadable: "Use the verification instruction printed on your statement.",
  passes: "This statement passes consistency checks, not yet verified with Safaricom.",
  doesNotPass: "This statement does not pass every consistency check, and is not yet verified with Safaricom.",
  chainBreaks: (count: number) => (count === 1 ? "1 row does not chain" : `${count} rows do not chain`),
  chainHolds: "Every row's balance follows from the one before",
  totals: {
    yes: "Totals match the statement's summary",
    no: "Totals do not match the statement's summary",
    not_found: "The statement's summary totals could not be found",
  },
  uncategorised: (rows: number, share: string) => `Uncategorised: ${rows} ${rows === 1 ? "row" : "rows"} (${share})`,
};

export const snapshot = {
  runLabel: "IMPORT SUMMARY",
  inflow: {
    label: "Total Inflow",
    detail: "All money received",
  },
  outflow: {
    label: "Total Outflow",
    detail: "Including M-PESA charges",
  },
  net: {
    label: "Net Cash Flow",
    detail: "Inflow minus outflow",
  },
  ctaLabel: "View Financial Overview",
};

export const limitations = {
  badge: "Analysis Completed with Limitations",
  summaryMiddle:
    " could not be classified by the engine and were recorded for review under ",
  bucket: "Unrecognized Event Type",
  scopeLabel: "Excluded/Limited Analytics Scope",
  exclusionNote:
    "These rows count towards total inflow and outflow, but not towards any spending, bill, transfer, investment or fee figure.",
  reviewLabel: "Review Unclassified Records",
  proceedLabel: "Proceed with Limitations",
};

export const integrityNotice = {
  title: "Investment Cadence: Insufficient historical periods",
  tag: "STATISTICAL INTEGRITY NOTICE",
  bodyBefore: "Only 1 month (",
  loadedPeriod: "July 2024",
  bodyAfter:
    ") is loaded. Multi-month investment growth velocity requires at least 2 consecutive statements.",
  status: "Status: Metric Not Available (N/A)",
  disclaimer: "(Explicitly distinct from KES 0.00)",
  unlockPrompt: "Add August 2024 to unlock velocity curves",
  uploadMoreLabel: "Upload More",
};

export const exploreNext = {
  title: "Ready to explore your spending, capital preservation, and tariffs?",
  description: "Explore deep liquidity breakdowns or inspect line-by-line M-Pesa receipts.",
  inspectLabel: "Inspect Raw Transactions First",
  overviewLabel: "Go to Financial Overview",
};

/** Ledger filter used when reviewing the rows the engine could not classify. */
export const UNMAPPED_FILTER = "unmapped";
