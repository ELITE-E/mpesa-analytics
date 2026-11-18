// The passphrase policy and the hint rules for "Remember on this device" (ADR 0016). Pure: no
// storage, no clock. A refusal carries a code and plain words; it never repeats the passphrase or
// the hint, because messages reach the screen and may be copied into a bug report (ADR 0004).

/** The longest hint allowed, in characters. */
export const HINT_MAX_LENGTH = 60;

/** A passphrase of at least this many characters is long enough without counting words. */
const MIN_PASSPHRASE_CHARACTERS = 16;
/** A passphrase of at least this many words is long enough without counting characters. */
const MIN_PASSPHRASE_WORDS = 4;
/** A word shorter than this does not count towards the word minimum ("a b c d" is not four words). */
const MIN_COUNTED_WORD_LENGTH = 3;
/** Fewer different characters than this (case ignored) make the passphrase a trivial repeat. */
const MIN_DISTINCT_CHARACTERS = 5;

export type PassphraseRefusalCode = "PASSPHRASE_TOO_SHORT" | "PASSPHRASE_TRIVIAL_REPEAT";
export type HintRefusalCode = "HINT_TOO_LONG" | "HINT_CONTAINS_PASSPHRASE_WORD";

/** A refusal: a code for the program and a message for the person, holding no secret. */
export type PolicyRefusal<Code extends string> = { ok: false; code: Code; message: string };

const PASSPHRASE_MESSAGES: Record<PassphraseRefusalCode, string> = {
  PASSPHRASE_TOO_SHORT: "Use at least four words, or at least 16 characters.",
  PASSPHRASE_TRIVIAL_REPEAT: "Avoid repeating the same characters or words. Choose words that are not all alike.",
};

const HINT_MESSAGES: Record<HintRefusalCode, string> = {
  HINT_TOO_LONG: `Keep the hint to ${HINT_MAX_LENGTH} characters or fewer.`,
  HINT_CONTAINS_PASSPHRASE_WORD: "The hint must not contain any word of your passphrase.",
};

/**
 * Check a new passphrase against the policy: at least four words (of three characters or more) or
 * at least 16 characters, and not a trivial repeat.
 *
 * @param passphrase What the person typed; anything that is not a string is too short.
 * @returns `{ ok: true }`, or a refusal with `PASSPHRASE_TOO_SHORT` or `PASSPHRASE_TRIVIAL_REPEAT`.
 *   Side effects: none.
 */
export function checkPassphrase(passphrase: unknown): { ok: true } | PolicyRefusal<PassphraseRefusalCode> {
  if (typeof passphrase !== "string" || !isLongEnough(passphrase)) return refusePassphrase("PASSPHRASE_TOO_SHORT");
  if (isTrivialRepeat(passphrase)) return refusePassphrase("PASSPHRASE_TRIVIAL_REPEAT");
  return { ok: true };
}

/**
 * Check an optional hint for a passphrase. Blank means no hint. The word rule also keeps the
 * passphrase itself out of the hint, since the passphrase contains its own words.
 *
 * @param hint The hint typed, or null/undefined for none.
 * @param passphrase The passphrase the hint is for (already accepted by `checkPassphrase`).
 * @returns `{ ok: true, hint }` with the trimmed hint or null, or a refusal with `HINT_TOO_LONG` or
 *   `HINT_CONTAINS_PASSPHRASE_WORD`. Side effects: none.
 */
export function checkHint(
  hint: string | null | undefined,
  passphrase: string,
): { ok: true; hint: string | null } | PolicyRefusal<HintRefusalCode> {
  const trimmed = (hint ?? "").trim();
  if (trimmed === "") return { ok: true, hint: null };
  if (trimmed.length > HINT_MAX_LENGTH) return refuseHint("HINT_TOO_LONG");
  if (holdsPassphraseWord(trimmed, passphrase)) return refuseHint("HINT_CONTAINS_PASSPHRASE_WORD");
  return { ok: true, hint: trimmed };
}

/**
 * Whether the passphrase meets either length rule.
 *
 * @param passphrase The passphrase.
 * @returns True for 16+ characters or four counted words. Side effects: none.
 */
function isLongEnough(passphrase: string): boolean {
  const countedWords = wordsOf(passphrase).filter((word) => word.length >= MIN_COUNTED_WORD_LENGTH);
  return [...passphrase.trim()].length >= MIN_PASSPHRASE_CHARACTERS || countedWords.length >= MIN_PASSPHRASE_WORDS;
}

/**
 * Whether the passphrase, spaces and case ignored, is one short pattern repeated or uses too few
 * different characters.
 *
 * @param passphrase The passphrase.
 * @returns True for a trivial repeat. Side effects: none.
 */
function isTrivialRepeat(passphrase: string): boolean {
  const compact = [...passphrase.toLowerCase().replace(/\s+/g, "")];
  if (new Set(compact).size < MIN_DISTINCT_CHARACTERS) return true;
  for (let unitLength = 1; unitLength <= compact.length / 2; unitLength += 1) {
    if (compact.length % unitLength !== 0) continue;
    if (compact.every((character, position) => character === compact[position % unitLength])) return true;
  }
  return false;
}

/**
 * Whether the hint holds any word of the passphrase, case ignored. Words of three characters or
 * more count anywhere inside the hint ("orbital" holds "orbit"); shorter words only as whole words.
 *
 * @param hint The trimmed hint.
 * @param passphrase The passphrase.
 * @returns True if any word is found. Side effects: none.
 */
function holdsPassphraseWord(hint: string, passphrase: string): boolean {
  const lowerHint = hint.toLowerCase();
  const hintWords = new Set(wordsOf(lowerHint));
  return wordsOf(passphrase.toLowerCase()).some((word) =>
    word.length >= MIN_COUNTED_WORD_LENGTH ? lowerHint.includes(word) : hintWords.has(word),
  );
}

/**
 * The whitespace-separated words of a text.
 *
 * @param text The text.
 * @returns Its non-empty words. Side effects: none.
 */
function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

/**
 * A passphrase refusal with its plain message.
 *
 * @param code The reason.
 * @returns The refusal. Side effects: none.
 */
function refusePassphrase(code: PassphraseRefusalCode): PolicyRefusal<PassphraseRefusalCode> {
  return { ok: false, code, message: PASSPHRASE_MESSAGES[code] };
}

/**
 * A hint refusal with its plain message.
 *
 * @param code The reason.
 * @returns The refusal. Side effects: none.
 */
function refuseHint(code: HintRefusalCode): PolicyRefusal<HintRefusalCode> {
  return { ok: false, code, message: HINT_MESSAGES[code] };
}
