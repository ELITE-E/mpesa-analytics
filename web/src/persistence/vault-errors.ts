// The vault's one error type (ADR 0016). A VaultError carries a code and a fixed plain message,
// and nothing else: never a passphrase, a hint, a ledger value or a stored byte (ADR 0004).

import type { ForbiddenContent } from "@/persistence/forbidden-content";
import type { HintRefusalCode, PassphraseRefusalCode } from "@/persistence/passphrase-policy";

export type VaultErrorCode =
  | PassphraseRefusalCode
  | HintRefusalCode
  | "VAULT_EXISTS"
  | "NO_VAULT"
  | "LOCKED"
  | "WRONG_PASSPHRASE"
  | "LEDGER_DAMAGED"
  | "SCHEMA_TOO_NEW"
  | "KDF_PARAMETERS_REFUSED"
  | "FORBIDDEN_CONTENT"
  | "STALE_LEDGER"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_WRITE_FAILED"
  | "ACCOUNT_DIGEST_INVALID";

const MESSAGES: Record<VaultErrorCode, string> = {
  PASSPHRASE_TOO_SHORT: "Use at least four words, or at least 16 characters.",
  PASSPHRASE_TRIVIAL_REPEAT: "Avoid repeating the same characters or words. Choose words that are not all alike.",
  HINT_TOO_LONG: "Keep the hint to 60 characters or fewer.",
  HINT_CONTAINS_PASSPHRASE_WORD: "The hint must not contain any word of your passphrase.",
  VAULT_EXISTS: "Saved data already exists on this device. Unlock it, or delete it first.",
  NO_VAULT: "Nothing is saved on this device.",
  LOCKED: "Saved data is locked. Unlock it with your passphrase first.",
  WRONG_PASSPHRASE: "That passphrase does not unlock the saved data on this device.",
  LEDGER_DAMAGED:
    "The saved data on this device is damaged or was changed outside the app. Nothing from it is shown. " +
    "You can delete the saved data and read your statements again.",
  SCHEMA_TOO_NEW:
    "The saved data on this device was written by a newer version of the app. Update the app to open it. " +
    "Nothing was changed.",
  KDF_PARAMETERS_REFUSED:
    "The saved data on this device uses weaker protection settings than this app accepts. Nothing was opened.",
  FORBIDDEN_CONTENT: "This app never saves PDF files, passwords or personal details, so nothing was saved.",
  STALE_LEDGER: "Another tab saved newer data. Reload this page to see it; nothing was overwritten.",
  STORAGE_UNAVAILABLE:
    "This browser does not allow saving on this device (for example in a private window). " +
    "The app still works; nothing will be kept after you close it.",
  STORAGE_QUOTA_EXCEEDED:
    "There is not enough storage space on this device to save. The previous saved data is unchanged; " +
    "the app keeps working without saving.",
  STORAGE_WRITE_FAILED: "Saving failed. The previous saved data is unchanged.",
  ACCOUNT_DIGEST_INVALID: "This statement's account could not be read, so it cannot be matched to saved data.",
};

/**
 * A vault failure: `code` for the program, `message` for the person, and for FORBIDDEN_CONTENT a
 * `detail` naming the kind of content (from a fixed list). Holds no values.
 */
export class VaultError extends Error {
  readonly code: VaultErrorCode;
  declare readonly detail?: ForbiddenContent;

  /**
   * Build the error for a code, with its fixed message.
   *
   * @param code What failed.
   * @param options `cause`: the original error, kept for debugging; it never holds stored values,
   *   since the vault only wraps IndexedDB and WebCrypto exceptions. `detail`: the kind of
   *   forbidden content, for FORBIDDEN_CONTENT only.
   */
  constructor(code: VaultErrorCode, options?: { cause?: unknown; detail?: ForbiddenContent }) {
    super(MESSAGES[code], options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    if (options?.detail !== undefined) Object.defineProperty(this, "detail", { value: options.detail, enumerable: true });
  }
}

// On the prototype, so an error's only own enumerable field is its code.
VaultError.prototype.name = "VaultError";

/**
 * The fixed message for a code.
 *
 * @param code The code.
 * @returns Its plain message. Side effects: none.
 */
export function vaultMessageFor(code: VaultErrorCode): string {
  return MESSAGES[code];
}
