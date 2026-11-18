// Test support for the vault (CP9a): a fresh fake IndexedDB per test (fake-indexeddb, which is the
// one external dependency these tests replace), Node's own WebCrypto, a manual clock for the idle
// lock, a spy for the persistent-storage request and a dump of everything the database holds.

import { IDBFactory } from "fake-indexeddb";

/** The iteration count unit tests derive keys with; the production floor is 600,000. */
export const TEST_ITERATIONS = 1_000;

/** An invented passphrase that meets the policy. */
export const PASSPHRASE = "lantern orbit pebble canyon";
/** Another invented passphrase that meets the policy. */
export const OTHER_PASSPHRASE = "violet harbour quartz meadow";

/**
 * Timers driven by the test: nothing fires until `advance` moves the clock past it.
 *
 * @returns {object} `setTimeout`, `clearTimeout`, `advance(ms)` and `pending()`.
 */
export function manualTimers() {
  let now = 0;
  let nextHandle = 1;
  const scheduled = new Map();
  return {
    setTimeout(callback, delay) {
      const handle = nextHandle++;
      scheduled.set(handle, { due: now + delay, callback });
      return handle;
    },
    clearTimeout(handle) {
      scheduled.delete(handle);
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [handle, timer] of [...scheduled].sort((first, second) => first[1].due - second[1].due)) {
        if (timer.due > now || !scheduled.has(handle)) continue;
        scheduled.delete(handle);
        timer.callback();
      }
    },
    pending() {
      return scheduled.size;
    },
  };
}

/**
 * A spy for `navigator.storage`: records each `persist()` request.
 *
 * @returns {{persist: Function, requests: number}} The spy.
 */
export function storageManagerSpy() {
  const spy = {
    requests: 0,
    async persist() {
      spy.requests += 1;
      return true;
    },
  };
  return spy;
}

/**
 * A fresh environment for one vault: its own empty IndexedDB, real WebCrypto, manual timers.
 *
 * @param {object} [overrides] Fields to replace.
 * @returns {object} The environment the vault factories take, plus the parts for assertions.
 */
export function vaultEnvironment(overrides = {}) {
  return {
    indexedDB: new IDBFactory(),
    crypto: globalThis.crypto,
    timers: manualTimers(),
    storageManager: storageManagerSpy(),
    ...overrides,
  };
}

/**
 * Names of the databases that exist in a factory.
 *
 * @param {IDBFactory} factory The IndexedDB factory.
 * @returns {Promise<string[]>} Database names.
 */
export async function databaseNames(factory) {
  return (await factory.databases()).map((database) => database.name);
}

/**
 * Every record of every store of every database in a factory, read without the vault.
 *
 * @param {IDBFactory} factory The IndexedDB factory.
 * @returns {Promise<Array<{database: string, store: string, key: unknown, value: unknown}>>} The records.
 */
export async function dumpDatabases(factory) {
  const records = [];
  for (const name of await databaseNames(factory)) {
    const database = await new Promise((resolve, reject) => {
      const request = factory.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const store of database.objectStoreNames) {
      const transaction = database.transaction(store, "readonly");
      const objectStore = transaction.objectStore(store);
      const [keys, values] = await Promise.all([requestOf(objectStore.getAllKeys()), requestOf(objectStore.getAll())]);
      keys.forEach((key, position) => records.push({ database: name, store, key, value: values[position] }));
    }
    database.close();
  }
  return records;
}

/**
 * The bytes of every string and binary value found anywhere inside `value`, keys included.
 *
 * @param {unknown} value Anything structured-cloneable.
 * @returns {Uint8Array[]} UTF-8 bytes of strings and keys, and the bytes of binary values.
 */
export function bytesInside(value) {
  const found = [];
  const encoder = new TextEncoder();
  const visit = (current) => {
    if (typeof current === "string") found.push(encoder.encode(current));
    else if (typeof current === "number" || typeof current === "bigint") found.push(encoder.encode(String(current)));
    else if (current instanceof ArrayBuffer) found.push(new Uint8Array(current));
    else if (ArrayBuffer.isView(current)) found.push(new Uint8Array(current.buffer, current.byteOffset, current.byteLength));
    else if (Array.isArray(current)) current.forEach(visit);
    else if (current && typeof current === "object") {
      for (const [key, nested] of Object.entries(current)) {
        found.push(encoder.encode(key));
        visit(nested);
      }
    }
  };
  visit(value);
  return found;
}

/**
 * Whether `needle` (text, as UTF-8, or bytes) appears inside any string or binary value of `value`.
 *
 * @param {unknown} value Where to look.
 * @param {string|Uint8Array} needle What to look for.
 * @returns {boolean} True if found.
 */
export function holdsBytes(value, needle) {
  const wanted = typeof needle === "string" ? new TextEncoder().encode(needle) : needle;
  return bytesInside(value).some((haystack) => indexOfBytes(haystack, wanted) !== -1);
}

/**
 * Whether any CryptoKey sits anywhere inside `value`.
 *
 * @param {unknown} value Where to look.
 * @returns {boolean} True if one is found.
 */
export function holdsCryptoKey(value) {
  if (value instanceof CryptoKey) return true;
  if (Array.isArray(value)) return value.some(holdsCryptoKey);
  if (value && typeof value === "object" && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
    return Object.values(value).some(holdsCryptoKey);
  }
  return false;
}

/**
 * Position of `needle` inside `haystack`, or -1.
 *
 * @param {Uint8Array} haystack Bytes to search.
 * @param {Uint8Array} needle Bytes to find.
 * @returns {number} The first position, or -1.
 */
function indexOfBytes(haystack, needle) {
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return start;
  }
  return -1;
}

/**
 * The outcome of an IndexedDB request.
 *
 * @param {IDBRequest} request The request.
 * @returns {Promise<unknown>} Its result.
 */
function requestOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
