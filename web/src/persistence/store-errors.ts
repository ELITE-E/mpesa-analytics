// The store's one error type (ADR 0017). A StoreError carries a code, a fixed plain message and,
// where useful, a `detail` from a fixed list (the core's code for a refused plan) or a row
// position; never a statement value (ADR 0004).

export type StoreErrorCode =
  | "TRANSACTION_INCOMPLETE"
  | "STATEMENT_INCOMPLETE"
  | "STATEMENT_NOT_FOUND"
  | "TRANSACTION_NOT_FOUND"
  | "UNKNOWN_OBSERVATION_CATEGORY"
  | "PLAN_REFUSED"
  | "PLAN_FAILED"
  | "ANALYSIS_FAILED"
  | "LEDGER_NOT_FOUND"
  | "IMPORT_ALREADY_SETTLED";

const MESSAGES: Record<StoreErrorCode, string> = {
  TRANSACTION_INCOMPLETE: "A transaction is missing a field, so nothing from this statement was saved.",
  STATEMENT_INCOMPLETE: "This statement has no transactions with a completion time, so it was not saved.",
  STATEMENT_NOT_FOUND: "That statement is not in the saved data.",
  TRANSACTION_NOT_FOUND: "That transaction is not in the saved data.",
  UNKNOWN_OBSERVATION_CATEGORY: "An observation of an unknown kind was refused, so nothing was saved.",
  PLAN_REFUSED: "The merge did not pass its check, so nothing was saved.",
  PLAN_FAILED: "The merge could not be worked out, so nothing was saved.",
  ANALYSIS_FAILED: "The figures across your saved statements could not be worked out.",
  LEDGER_NOT_FOUND: "That saved account is not on this device.",
  IMPORT_ALREADY_SETTLED: "This merge was already saved or cancelled.",
};

/** A store failure: `code` for the program, `message` for the person. Holds no values. */
export class StoreError extends Error {
  readonly code: StoreErrorCode;
  declare readonly detail?: string;
  declare readonly rowIndex?: number;

  /**
   * Build the error for a code, with its fixed message.
   *
   * @param code What failed.
   * @param options `detail`: the core's code for PLAN_REFUSED, PLAN_FAILED or ANALYSIS_FAILED;
   *   `rowIndex`: the row involved, by position.
   */
  constructor(code: StoreErrorCode, options: { detail?: string; rowIndex?: number | null } = {}) {
    super(MESSAGES[code]);
    this.code = code;
    if (options.detail !== undefined) Object.defineProperty(this, "detail", { value: options.detail, enumerable: true });
    if (typeof options.rowIndex === "number") {
      Object.defineProperty(this, "rowIndex", { value: options.rowIndex, enumerable: true });
    }
  }
}

// On the prototype, so an error's own fields are only its code and details.
StoreError.prototype.name = "StoreError";
