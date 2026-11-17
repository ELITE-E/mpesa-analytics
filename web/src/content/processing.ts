// Static copy for the Processing screen, taken from the Stitch HTML
// (stitch-export/processing/processing.html) unless marked otherwise. Stage
// details that described checks the backend does not perform were changed.

export type PipelineStage = {
  title: string;
  detail: string;
  /** Status shown once the stage finishes, e.g. "Completed" or "94 identified". */
  doneLabel: string;
};

export const header = {
  title: "Ingestion Processing",
  tag: "Private on this device",
  backLabel: "Go back",
};

export const hero = {
  stepLabel: "Processing Statement • Step 2 of 2",
  title: "Analyzing Your M-Pesa Statement",
  description:
    "Extracting transactions, isolating investments, and separating M-PESA charges.",
};

export const pipelineCard = {
  title: "Analysis Pipeline",
  /** Not in Stitch: replaces the placeholder audit id until one exists. */
  pendingId: "Import pending",
  inProgressLabel: "In Progress",
  queuedLabel: "Queued",
  footnote: "Everything runs in this browser. A long statement can take a few minutes; please keep this screen open.",
  // CP8b: the engine reports each page it reads, and the user can stop it.
  pageProgress: (page: number, pageCount: number) => `Page ${page} of ${pageCount}`,
  cancelLabel: "Stop reading",
  // Not in Stitch: shown when the screen is opened without a chosen file.
  noStatement: "No statement is waiting to be processed. Choose one to upload.",
  noStatementAction: "Choose a statement",
};

export const stages: PipelineStage[] = [
  {
    title: "PDF Statement Decryption & Ingestion",
    detail: "Unlocked and read in this browser; M-PESA branding and layout checked; verification code read from the statement.",
    doneLabel: "Completed",
  },
  {
    title: "Normalizing transaction rows",
    detail: "Sanitized timestamps, ISO currency formats, and receipt IDs.",
    doneLabel: "Completed",
  },
  {
    title: "Classifying Paybills, Tills & Investment Outflows",
    detail: "Classifying each transaction and attributing its charges.",
    // Not in Stitch: the design only shows this stage in progress.
    doneLabel: "Completed",
  },
  {
    title: "Synthesizing Financial Narrative & Tariffs",
    detail: "Computing cash flow, spending, transfers, investments and fees, kept in memory for this session only.",
    // Not in Stitch: the design only shows this stage queued.
    doneLabel: "Completed",
  },
];

