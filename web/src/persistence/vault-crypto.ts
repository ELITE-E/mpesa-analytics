// WebCrypto for the vault (ADR 0016): PBKDF2-SHA256 from the passphrase to a non-extractable
// AES-GCM 256-bit key, and sealing and opening of blobs with a fresh random 12-byte IV each time.
// No crypto library: the browser's own implementation only.

/** Length of the random salt, in bytes. */
export const SALT_BYTES = 16;
/** Length of an AES-GCM IV, in bytes; a fresh one for every seal. */
export const IV_BYTES = 12;

/** A sealed blob as stored: the IV and the AES-GCM ciphertext with its tag. */
export type SealedBlob = { iv: Uint8Array; ciphertext: Uint8Array };

/**
 * A fresh random salt.
 *
 * @param cryptoApi The WebCrypto object.
 * @returns 16 random bytes. Side effects: reads the random source.
 */
export function randomSalt(cryptoApi: Crypto): Uint8Array {
  return cryptoApi.getRandomValues(new Uint8Array(SALT_BYTES));
}

/**
 * Derive the vault key from a passphrase.
 *
 * @param cryptoApi The WebCrypto object.
 * @param passphrase The passphrase, as typed.
 * @param salt The vault's salt.
 * @param iterations PBKDF2 iterations.
 * @returns A non-extractable AES-GCM 256-bit key for encrypt and decrypt. Side effects: none.
 */
export async function deriveVaultKey(
  cryptoApi: Crypto,
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The associated data that binds a blob to where it belongs: authenticated with the blob but not
 * stored in it, so a blob moved to another slot, given another version counter or read under
 * another schema version fails authentication.
 *
 * @param binding The slot ("key_check" or "ledger:<id>"), the schema version and the blob's version
 *   counter (0 for the key check).
 * @returns The bytes to authenticate. Side effects: none.
 */
export function associatedDataFor(binding: { slot: string; schemaVersion: number; version: number }): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(["mpesa-analytics-vault", binding.schemaVersion, binding.slot, binding.version]),
  );
}

/**
 * Encrypt bytes under the key with a fresh random IV, bound to `associatedData`.
 *
 * @param cryptoApi The WebCrypto object.
 * @param key The vault key.
 * @param plaintext The bytes to seal.
 * @param associatedData From `associatedDataFor`.
 * @returns The IV and ciphertext. Side effects: reads the random source.
 */
export async function sealBlob(
  cryptoApi: Crypto,
  key: CryptoKey,
  plaintext: Uint8Array,
  associatedData: Uint8Array,
): Promise<SealedBlob> {
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

/**
 * Whether a stored value has the shape of a sealed blob: a 12-byte IV and a ciphertext.
 *
 * @param stored A value read from storage.
 * @returns True if it can be passed to `openBlob`. Side effects: none.
 */
export function isSealedBlob(stored: unknown): stored is SealedBlob {
  const candidate = stored as Partial<SealedBlob> | null;
  return (
    candidate?.iv instanceof Uint8Array &&
    candidate.iv.length === IV_BYTES &&
    candidate.ciphertext instanceof Uint8Array
  );
}

/**
 * Decrypt and authenticate a sealed blob.
 *
 * @param cryptoApi The WebCrypto object.
 * @param key The vault key.
 * @param sealed The stored IV and ciphertext.
 * @param associatedData From `associatedDataFor`, for where the blob was read from.
 * @returns The plaintext bytes, all of them or none. Side effects: none.
 * @throws {DOMException} OperationError when the key is wrong, the blob was changed or truncated,
 *   or it belongs to another slot, version counter or schema version.
 */
export async function openBlob(
  cryptoApi: Crypto,
  key: CryptoKey,
  sealed: SealedBlob,
  associatedData: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = await cryptoApi.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv as BufferSource, additionalData: associatedData as BufferSource },
    key,
    sealed.ciphertext as BufferSource,
  );
  return new Uint8Array(plaintext);
}
