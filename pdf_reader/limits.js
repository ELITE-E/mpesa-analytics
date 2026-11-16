// The statement engine's limits on desktop, from measuring the synthetic F-LARGE statement in
// headless Chrome (docs/decisions/cp8-notes.md, "Desktop limits"). Phone limits are unverified.

/**
 * Largest PDF, most pages and longest run accepted on desktop.
 *
 * - byteLimit: 10 MiB. A 298-page uncompressed synthetic statement is 9,446,847 bytes; real
 *   statements are compressed and smaller. It is also the old API's limit.
 * - pageLimit: 300 pages, about twice the largest real statement seen (148 pages).
 * - timeoutMs: 600 s, twice the measured cold run (289 s) of that 298-page statement.
 */
export const DESKTOP_LIMITS = Object.freeze({
  byteLimit: 10 * 1024 * 1024,
  pageLimit: 300,
  timeoutMs: 600_000,
});
