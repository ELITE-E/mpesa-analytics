// The error every data-layer call rejects with. Kept from the old API client (lib/api.ts), so the
// UI's error handling fits unchanged; its codes are now local: the statement engine's codes, the
// core's codes, and a few of the data layer's own.

export class ApiError extends Error {
  /**
   * Record a failure the UI can show.
   *
   * @param status 0 when trying again unchanged could work; otherwise 400 (the file or password)
   *   or 422 (the statement could not be read as an M-PESA statement), or 404 (no such import).
   * @param code A stable code, such as "PASSWORD_INCORRECT" or "BRAND_MISSING".
   * @param message Text safe to show the user: never a statement value.
   */
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Always false: there is no account to be signed out of. Kept for the UI's existing checks. */
  get isUnauthenticated() {
    return false;
  }

  /** Failures worth retrying unchanged: nothing was wrong with the file or the password. */
  get isRetryable() {
    return this.status === 0 || this.status >= 500;
  }
}
