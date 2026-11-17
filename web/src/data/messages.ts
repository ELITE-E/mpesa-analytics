// What the user is told for each failure, by code: one distinct message per statement engine code
// and per core code (CP8b item 2). Messages never hold a statement value (ADR 0004).

import { ApiError } from "@/data/api-error";

/** The statement engine's failure codes (pdf_reader/bridge.js). */
export const ENGINE_CODES = [
  "NOT_A_PDF",
  "PASSWORD_REQUIRED",
  "PASSWORD_INCORRECT",
  "CORRUPT_PDF",
  "TOO_LARGE",
  "TOO_MANY_PAGES",
  "TIMEOUT",
  "LAYOUT_UNRECOGNIZED",
  "ENGINE_FAILED",
] as const;

/** The core's codes, carried as `core_code` (mpesa_core.errors and bridge.run_json). */
export const CORE_CODES = [
  "NO_PAGES",
  "BRAND_MISSING",
  "ANCHOR_MISSING",
  "TOKEN_MISSING",
  "DOMAIN_ROW",
  "DATE_UNREADABLE",
  "ANALYSIS_FAILED",
  "TOO_FEW_AMOUNTS",
] as const;

/** The data layer's own codes. */
export const LOCAL_CODES = ["CANCELLED", "import_not_found", "no_statement", "unexpected_error"] as const;

const MESSAGES: Record<string, string> = {
  NOT_A_PDF: "This file isn't a PDF. Choose the statement PDF that M-PESA sent you.",
  PASSWORD_REQUIRED:
    "This statement is protected with a password. Enter the password from the M-PESA message.",
  PASSWORD_INCORRECT:
    "That password didn't open the statement. Check the password from the M-PESA message and try again.",
  CORRUPT_PDF: "This PDF looks damaged and couldn't be opened. Download the statement again and retry.",
  TOO_LARGE: "This file is larger than 10 MB, more than a statement should be. Check it's the right file.",
  TOO_MANY_PAGES:
    "This statement has more than 300 pages, more than this device can read at once. Ask for a shorter period.",
  TIMEOUT: "Reading this statement took too long and was stopped. Try again; closing other tabs can help.",
  LAYOUT_UNRECOGNIZED: "The pages were read, but no transaction table this app recognises was found on them.",
  ENGINE_FAILED: "The app's statement reader didn't start or stopped unexpectedly. Reload the page and try again.",
  NO_PAGES: "The PDF opened but has no pages to read.",
  BRAND_MISSING: "This doesn't look like an M-PESA statement: its first page doesn't name M-PESA.",
  ANCHOR_MISSING:
    "The first page lacks the verification instruction an M-PESA statement prints, so it isn't read as one.",
  TOKEN_MISSING: "The first page has no verification code, so this statement can't be checked with Safaricom.",
  DOMAIN_ROW: "A row came out with both money in and money out, so the table wasn't read reliably.",
  DATE_UNREADABLE: "A transaction's date couldn't be read, so the analysis stopped. Nothing was kept.",
  ANALYSIS_FAILED: "The transactions were read, but the analysis couldn't be completed. Nothing was kept.",
  TOO_FEW_AMOUNTS:
    "This statement has too few money-in or money-out entries for its columns to be found. A statement covering a longer period should work.",
  CANCELLED: "You stopped reading this statement. Nothing from it was kept.",
  import_not_found: "That statement isn't open in this session. Statements are forgotten when the page reloads.",
  no_statement: "Choose a statement to read first.",
  unexpected_error: "Something went wrong while reading the statement. Please try again.",
};

/** Codes for which trying again unchanged could work. */
const RETRYABLE = new Set(["TIMEOUT", "ENGINE_FAILED", "unexpected_error"]);
/** Codes about the file or its password, rather than its contents. */
const FILE_CODES = new Set(["NOT_A_PDF", "PASSWORD_REQUIRED", "PASSWORD_INCORRECT", "CORRUPT_PDF", "TOO_LARGE", "TOO_MANY_PAGES", "CANCELLED", "no_statement"]);

/**
 * The message for a code.
 *
 * @param code An engine, core or local code.
 * @returns Its message; the unexpected-error message for a code this app does not know.
 */
export function messageFor(code: string): string {
  return MESSAGES[code] ?? MESSAGES.unexpected_error;
}

/**
 * Build the ApiError for a code.
 *
 * @param code An engine, core or local code.
 * @returns The error, with a status that says whether retrying unchanged could work.
 */
export function apiErrorFor(code: string): ApiError {
  const status = RETRYABLE.has(code) ? 0 : code === "import_not_found" ? 404 : FILE_CODES.has(code) ? 400 : 422;
  return new ApiError(status, code, messageFor(code));
}

/**
 * Turn the statement engine's failure into the UI's error, using the core's own code when there is
 * one, since it says more (a page that is not an M-PESA statement, an unreadable date, ...).
 *
 * @param failure The engine's `{code, stage, core_code?}`.
 * @returns The ApiError.
 */
export function toApiError(failure: { code: string; stage?: string; core_code?: string }): ApiError {
  return apiErrorFor(failure.core_code ?? failure.code);
}
