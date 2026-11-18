// Copy for "Remember on this device" (CP9c): the opt-in card, unlock, the merge screen, the
// ledger switcher and settings. Every claim the copy makes is one entry of `claims`, and
// web/tests/remember-claims.test.mjs names the test that proves each one. The wording follows
// docs/THREAT_MODEL.md: what the lock protects and what it does not.

/** Every claim the screens make about remembering, in plain words. */
export const claims = {
  lockedWithPassphrase:
    "Your saved statements are locked with your passphrase. Without it, the data saved on this device cannot be read.",
  nothingSavedUnlessOn: "Nothing is saved unless you turn this on.",
  neverSaved: "Your PDF, its password and its verification code are never saved.",
  accountsApart: "Statements from different M-Pesa accounts are kept apart, each in its own ledger.",
  autoLock: "It locks itself after 10 minutes without activity.",
  keepStorage: "When you turn it on, the app asks your browser to keep this data.",
  openWhileUnlocked: "While it is unlocked, anyone using this device can see your statements.",
  downloadsNotLocked: "PDF statements and CSV files you download are ordinary files: the lock does not cover them.",
  weakPassphrase: "A passphrase that is easy to guess can be guessed. Use words that are not about you.",
  noRecovery:
    "If you forget your passphrase, nothing can recover it: delete the saved data and read your PDFs again.",
  hintPlain: "The hint is stored without encryption, so anyone with this device can read it.",
  hintAfterFailure: "The hint is shown only after a wrong passphrase.",
  nothingWrittenUntilConfirmed: "Nothing is saved until you confirm.",
  collisionsKept: "Rows that share a receipt but differ are kept side by side, never overwritten.",
  noReplace: "A statement is never replaced: a different account gets its own ledger.",
  deleteRemovesAll:
    "Removes everything this app saved on this device: every ledger, the protection settings and the hint.",
  removeTakesOnlyItsRows: "Its transactions that no other statement printed are removed too.",
} as const;

export type ClaimId = keyof typeof claims;

/** The opt-in card (item 1). */
export const rememberCard = {
  title: "Remember on this device",
  offBadge: "Off",
  onBadge: "On",
  lockedBadge: "Locked",
  intro: "Off by default. Turn it on to keep your statements on this device between visits, locked with a passphrase you choose.",
  protectsTitle: "What the lock protects",
  protects: ["lockedWithPassphrase", "nothingSavedUnlessOn", "neverSaved", "accountsApart", "autoLock", "keepStorage"] as ClaimId[],
  limitsTitle: "What it does not protect",
  limits: ["openWhileUnlocked", "downloadsNotLocked", "weakPassphrase", "noRecovery"] as ClaimId[],
  turnOnLabel: "Choose a passphrase",
  passphraseLabel: "Passphrase",
  passphraseHelp: "At least four words, or at least 16 characters.",
  confirmLabel: "Passphrase again",
  hintLabel: "Hint (optional)",
  hintWarning: claims.hintPlain,
  hintRule: "It must not contain any word of your passphrase, and is shown only after a wrong passphrase.",
  submitLabel: "Turn on remembering",
  cancelLabel: "Not now",
  passphrasesDiffer: "The two passphrases are different. Type the same passphrase twice.",
  turnedOn: "Remembering is on. Each statement you read from now on is saved here, locked, once you confirm it.",
  unavailableTitle: "Saving is not available in this browser",
};

/** The unlock screen, the lock button and the auto-lock notice (item 2). */
export const unlock = {
  title: "Unlock your saved statements",
  description: "Type your passphrase to open the statements saved on this device.",
  passphraseLabel: "Passphrase",
  submitLabel: "Unlock",
  wrongPassphrase: "That passphrase does not unlock the saved data on this device.",
  hintLabel: "Your hint",
  idleNotice: "Locked after 10 minutes without activity. Your saved statements are safe; unlock to continue.",
  lockedNotice: "Locked. Your saved statements are safe; unlock to continue.",
  elsewhereNotice: "The saved data was changed in another tab. Unlock to continue.",
  lockLabel: "Lock",
  lockedChip: "Locked",
  unlockChip: "Unlock",
  forgotTitle: "Forgot it?",
  forgotBody: claims.noRecovery,
  forgotAction: "Delete saved data and start again",
};

/** Delete-all, from unlock and from settings, always with a confirmation (items 2 and 5). */
export const deleteAll = {
  title: "Delete all saved data",
  body: `${claims.deleteRemovesAll} Your PDF files are not touched.`,
  action: "Delete all saved data",
  confirmQuestion: "Delete everything saved on this device? This cannot be undone.",
  confirmAction: "Yes, delete everything",
  keepAction: "Keep it",
  done: "All saved data was deleted. Remembering is off.",
};

/** The merge screen (items 3 and 4). */
export const merge = {
  title: "Save this statement?",
  description: claims.nothingWrittenUntilConfirmed,
  newLabel: "New transactions",
  matchedLabel: "Already saved",
  collidedLabel: "Kept side by side",
  collidedHelp: claims.collisionsKept,
  newLedgerNote: "This is the first statement for this M-Pesa account on this device.",
  differentAccountTitle: "This looks like a different M-Pesa account. Open it as a separate ledger.",
  differentAccountBody: claims.noReplace,
  confirmLabel: "Save",
  confirmSeparateLabel: "Open as a separate ledger",
  cancelLabel: "Don't save",
  cancelled: "Nothing was saved.",
  unreadableTitle: "We could not read which M-Pesa account this statement belongs to.",
  unreadableBody: "Choose the saved ledger it belongs to, or don't save it.",
  chooseLedgerLabel: "Add to this ledger",
  savedTitle: "Saved",
  savedSummary: (inserted: number, matched: number, collided: number) =>
    `${inserted} new, ${matched} already saved, ${collided} kept side by side.`,
  collisionCount: (collided: number) =>
    collided === 1 ? "1 collision was kept side by side." : `${collided} collisions were kept side by side.`,
  viewAnalysis: "See the analysis",
  missing: "There is no statement waiting to be saved. Read a statement first.",
  missingAction: "Read a statement",
};

/** The settings screen: ledgers, statements, delete-all (items 3 and 5). */
export const settings = {
  title: "Saved on this device",
  ledgersTitle: "Ledgers",
  ledgersHelp: "One ledger per M-Pesa account. Switch to see another account's statements.",
  currentLedger: "Showing",
  switchLabel: "Show this ledger",
  ledgerLabel: (start: string, end: string, statements: number) =>
    `${start} to ${end} · ${statements} ${statements === 1 ? "statement" : "statements"}`,
  statementsTitle: "Statements in this ledger",
  noStatements: "No statements are saved in this ledger yet.",
  removeLabel: "Remove",
  removeQuestion: `Remove this statement? ${claims.removeTakesOnlyItsRows} This cannot be undone.`,
  removeConfirm: "Yes, remove it",
  removeKeep: "Keep it",
  removed: "The statement was removed.",
  settingsLink: "Saved data",
};
