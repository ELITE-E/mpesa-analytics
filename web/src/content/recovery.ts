// Copy for the Statement Interrupted & Recovery screen. Layout and the USSD
// guidance come from the Stitch HTML (stitch-export/interrupted/
// interrupted.html). The remedies follow the statement engine's and the core's
// codes (src/data/messages.ts holds each code's message).

export const statusBar = {
  dismissLabel: "Dismiss",
  label: "Exception Handling • Recovery",
  lockTitle: "Nothing was stored",
};

export const hero = {
  title: "Statement Not Imported",
  description:
    "The statement could not be imported. Nothing from this attempt was saved, so you can safely try again.",
};

const PASSWORD_REMEDY = "Check the statement password Safaricom sent you and enter it exactly.";
const ORIGINAL_PDF_REMEDY = "Upload the original PDF statement from Safaricom, not a scan or an edited copy.";

/** What the user can do about each failure, by the engine's or the core's code. */
export const remedies: Record<string, string> = {
  PASSWORD_REQUIRED: PASSWORD_REMEDY,
  PASSWORD_INCORRECT: PASSWORD_REMEDY,
  NOT_A_PDF: "Only PDF statements can be read.",
  CORRUPT_PDF: "The file looks damaged. Download the statement again and retry.",
  TOO_LARGE: "The file is larger than statements usually are. Check it is the right file.",
  TOO_MANY_PAGES: "Ask Safaricom for a statement covering a shorter period.",
  BRAND_MISSING: ORIGINAL_PDF_REMEDY,
  ANCHOR_MISSING: ORIGINAL_PDF_REMEDY,
  TOKEN_MISSING: ORIGINAL_PDF_REMEDY,
  LAYOUT_UNRECOGNIZED: ORIGINAL_PDF_REMEDY,
  DOMAIN_ROW: "This statement contains transactions the analyser cannot read yet.",
  DATE_UNREADABLE: "This statement contains transactions the analyser cannot read yet.",
  TIMEOUT: "Close other tabs to free memory, then try again.",
  ENGINE_FAILED: "Reload the page, then try again.",
};

export const failureCard = {
  title: "Upload & Analysis Failed",
  savedNote: "No transactions or analytics from this attempt were stored.",
  retryLabel: "Try Again",
  retryingLabel: "Retrying…",
  chooseAnotherLabel: "Choose Another Statement",
  // Shown when the screen is opened without a failed upload in this tab.
  noFailure: "There is no failed upload to recover in this tab.",
};

export const ussd = {
  before: "Need a fresh statement? Dial",
  code: "*334#",
  after: "to request an official Safaricom e-statement directly to your email.",
  dialLabel: "Dial",
  href: "tel:*334%23",
};
