// Static copy for the Upload screen, taken from the Stitch HTML
// (stitch-export/upload/upload.html) unless marked otherwise. Statements are
// read in this browser by the local statement engine (CP8b).

import { MAX_STATEMENT_BYTES } from "@/lib/api";

export { MAX_STATEMENT_BYTES };

export type StatementMetadata = {
  name: string;
  /** File size in bytes. */
  size: number;
  /** Ledger rows found by the parser; null until the statement is parsed. */
  rows: number | null;
  /** Statement period, e.g. "July 1 – July 31, 2024"; null until parsed. */
  period: string | null;
  isValidated: boolean;
};

export type PipelineStep = {
  icon: string;
  title: string;
  detail: string;
};

export function formatStatementSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_STATEMENT_MB = Math.floor(MAX_STATEMENT_BYTES / (1024 * 1024));

export const hero = {
  stepLabel: "Statement Ingestion • Step 1 of 2",
  title: "Upload M-Pesa Statement",
  description:
    "Import your official Safaricom PDF statement to see where your money went and what you paid in charges.",
};

export const activeStatement = {
  title: "Active Statement",
  readyLabel: "Ready",
  // Stage 8b (C-16): no hashing and no ID vault, so neither is claimed.
  unlockNote: "Read from your statement",
  removeLabel: "Remove",
  // Not in Stitch: the design only shows an already-parsed statement.
  pendingLabel: "Pending",
  pendingNote: "Processed when you proceed",
};

export const dropzone = {
  replaceTitle: "Replace or Add Period",
  // Not in Stitch: the design has no empty state.
  emptyTitle: "Select Statement",
  badge: "Official PDF only",
  prompt: "Tap to browse or drop statement here",
  caption: `Safaricom e-Statement • Max ${MAX_STATEMENT_MB}MB`,
  tags: [".PDF", "Password-Protected OK", "Fuliza & Till Matrix"],
  // Not in Stitch: validation messages.
  notPdfError: "Only official Safaricom PDF statements are supported.",
  tooLargeError: `That file is larger than ${MAX_STATEMENT_MB}MB.`,
};

export const pipeline = {
  title: "Analysis Pipeline",
  badge: "Private on this device",
};

export const pipelineSteps: PipelineStep[] = [
  { icon: "terminal", title: "Parse PDF", detail: "Extract receipt logs" },
  { icon: "category", title: "Classify", detail: "Sort payments by type" },
  { icon: "insights", title: "Analyze", detail: "Calculate tariff drags" },
];

export const proceedCallToAction = {
  label: "Proceed to Analysis",
  reassurance:
    "Read in this browser. The PDF, its password and its transactions never leave this device, and a reload forgets them.",
};

// Not in Stitch: the design has no password field.
export const passwordField = {
  label: "Statement Password",
  hint: "The code Safaricom sent with your statement. Leave empty if the PDF is not password-protected.",
};
