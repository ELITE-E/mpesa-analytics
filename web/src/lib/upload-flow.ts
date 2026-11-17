// Hands a chosen statement from /upload to /processing, and the outcome from
// /processing to /analysis-summary or /recovery. Held in module memory only:
// the PDF and its password are never written to storage, and a page reload
// forgets them (the processing screen then asks for the file again).

import { ApiError, cancelUpload, uploadStatement, type CreatedImport, type UploadProgress } from "@/lib/api";

type PendingUpload = { file: File; password: string };

let pending: PendingUpload | null = null;
let inFlight: Promise<CreatedImport> | null = null;
let lastFailure: ApiError | null = null;
let lastSuccess: CreatedImport | null = null;
let progress: UploadProgress | null = null;
const progressListeners = new Set<() => void>();

export function setPendingUpload(file: File, password: string) {
  pending = { file, password };
  inFlight = null;
  lastFailure = null;
  setProgress(null);
}

/** The latest step of the upload in progress, or null before the engine reports one. */
export function uploadProgress() {
  return progress;
}

/**
 * Be told whenever the upload reports a step (for useSyncExternalStore).
 *
 * @param listener Called after each step.
 * @returns A function that stops the listening.
 */
export function subscribeUploadProgress(listener: () => void) {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/**
 * Stop reading the pending statement. The engine terminates its worker, the upload rejects with
 * "CANCELLED", and the file and password are forgotten.
 */
export function cancelPendingUpload() {
  cancelUpload();
  pending = null;
}

/** Forget everything: for tests only. */
export function resetUploadFlowForTests() {
  pending = null;
  inFlight = null;
  lastFailure = null;
  lastSuccess = null;
  setProgress(null);
}

function setProgress(step: UploadProgress | null) {
  progress = step;
  for (const listener of progressListeners) listener();
}

export function hasPendingUpload() {
  return pending !== null;
}

export function pendingFileName() {
  return pending?.file.name ?? null;
}

/**
 * Upload the pending statement. Repeated calls while a request is running
 * share it, so a re-rendered screen can never submit the statement twice.
 */
export function submitPendingUpload(): Promise<CreatedImport> {
  if (!pending) {
    return Promise.reject(
      new ApiError(0, "no_statement", "Choose a statement to upload first."),
    );
  }
  if (!inFlight) {
    const { file, password } = pending;
    inFlight = uploadStatement(file, password, { onProgress: setProgress }).then(
      (created) => {
        lastSuccess = created;
        // The import is stored; forget the PDF and its password.
        pending = null;
        inFlight = null;
        return created;
      },
      (error: unknown) => {
        inFlight = null;
        lastFailure =
          error instanceof ApiError
            ? error
            : new ApiError(0, "unexpected_error", "Something went wrong. Please try again.");
        // Keep the file only while a retry could succeed unchanged.
        if (!lastFailure.isRetryable) pending = null;
        throw lastFailure;
      },
    );
  }
  return inFlight;
}

export function lastUploadFailure() {
  return lastFailure;
}

/** The verification token of an import uploaded in this tab, if any. */
export function verificationTokenFor(importId: number) {
  return lastSuccess?.import.id === importId ? lastSuccess.verification_token : null;
}
