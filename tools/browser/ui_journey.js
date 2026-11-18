// Steps through the real UI as a user would, shared by the owner's ui_run and the download
// measurement: choose a statement on /upload and wait for where the app lands, then move between
// screens with the app's own links, so the in-memory session stays. With "Remember on this
// device" (CP9c): turn it on in /settings, then read statements to the merge screen and save them;
// moving by links matters there too, since a full page load locks the saved data.

const PROCEED = "Proceed to Analysis";

/**
 * Choose the statement on /upload, proceed, and wait for the summary or /recovery.
 *
 * Side effects: drives the page; the password, if any, is typed into the app's field only.
 *
 * @param {object} page The page.
 * @param {string} origin The app's origin.
 * @param {Buffer} pdfBytes The PDF.
 * @param {object} options How to import.
 * @param {string} [options.password] The password, or "" for none.
 * @param {number} options.importTimeoutMs How long the import may take.
 * @param {number} options.pageTimeoutMs How long /recovery may take to show its code.
 * @returns {Promise<{code: string|null}>} The failure code /recovery shows, or null on success.
 */
export async function import_statement(page, origin, pdfBytes, options) {
  await page.goto(`${origin}/upload/`);
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: pdfBytes });
  if (options.password) await page.locator('input[type="password"]').fill(options.password);
  await page.getByRole("button", { name: PROCEED }).click();
  await page.waitForURL(/\/(analysis-summary|recovery)/, { timeout: options.importTimeoutMs });
  if (!page.url().includes("/recovery")) return { code: null };
  // /recovery prints the failure's code beside the card's heading; textContent, as typed.
  const badge = page.locator("main h2 + span").first();
  await badge.waitFor({ timeout: options.pageTimeoutMs });
  const code = (await badge.textContent()).trim();
  return { code: /^[A-Za-z_]+$/.test(code) ? code : "UNKNOWN" };
}

/**
 * Follow the app's own link to a route. The app is exported with trailing slashes, so a link may
 * read "/overview/?import=1".
 *
 * Side effects: drives the page.
 *
 * @param {object} page The page.
 * @param {string} route The path, without its query or trailing slash.
 */
export async function follow(page, route) {
  const forms = [
    `a[href="${route}"]`,
    `a[href="${route}/"]`,
    `a[href^="${route}?"]`,
    `a[href^="${route}/?"]`,
  ];
  await page
    .locator(forms.map((form) => `${form}:visible`).join(", "))
    .first()
    .click();
  await page.waitForURL((url) => url.pathname.replace(/\/$/, "") === route);
}

/**
 * Turn "Remember on this device" on through the settings card, on a fresh profile.
 *
 * Side effects: drives the page; the passphrase is typed into the app's fields only.
 *
 * @param {object} page The page.
 * @param {string} origin The app's origin.
 * @param {string} passphrase The passphrase, typed twice; no hint.
 * @param {number} pageTimeoutMs How long the vault may take to be created.
 */
export async function turn_on_remember(page, origin, passphrase, pageTimeoutMs) {
  await page.goto(`${origin}/settings`);
  await page.locator("[data-remember-turn-on]").click();
  await page.locator('input[name="passphrase"]').fill(passphrase);
  await page.locator('input[name="confirmation"]').fill(passphrase);
  await page.locator("[data-remember-submit]").click();
  await page.locator("[data-lock-button]:visible").waitFor({ timeout: pageTimeoutMs });
}

/**
 * Read a statement with remembering on and wait for the merge screen (or /recovery). The upload
 * screen is reached by the app's own link, so the saved data stays unlocked.
 *
 * Side effects: drives the page.
 *
 * @param {object} page The page.
 * @param {Buffer} pdfBytes The PDF.
 * @param {object} options `password`, `importTimeoutMs`, `pageTimeoutMs`.
 * @returns {Promise<{code: string|null}>} The failure code /recovery shows, or null at /merge.
 */
export async function read_to_merge(page, pdfBytes, options) {
  await follow(page, "/upload");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: pdfBytes });
  if (options.password) await page.locator('input[type="password"]').fill(options.password);
  await page.getByRole("button", { name: PROCEED }).click();
  await page.waitForURL(/\/(merge|recovery)/, { timeout: options.importTimeoutMs });
  if (!page.url().includes("/recovery")) {
    await page.locator("[data-merge-counts]").waitFor({ timeout: options.pageTimeoutMs });
    return { code: null };
  }
  const badge = page.locator("main h2 + span").first();
  await badge.waitFor({ timeout: options.pageTimeoutMs });
  const code = (await badge.textContent()).trim();
  return { code: /^[A-Za-z_]+$/.test(code) ? code : "UNKNOWN" };
}

/**
 * The merge screen's counts, then save: the one write.
 *
 * Side effects: drives the page.
 *
 * @param {object} page The page, on /merge.
 * @param {number} pageTimeoutMs How long the save may take.
 * @returns {Promise<{inserted: number, matched: number, collided: number}>} The counts shown
 *   before saving.
 */
export async function save_merge(page, pageTimeoutMs) {
  /**
   * One count the merge screen shows.
   *
   * @param {string} name `new`, `matched` or `collided`.
   * @returns {Promise<number>} The count.
   */
  const count = async (name) => Number(await page.locator(`[data-count="${name}"]`).innerText());
  const counts = {
    inserted: await count("new"),
    matched: await count("matched"),
    collided: await count("collided"),
  };
  await page.locator("[data-merge-confirm]").click();
  await page.locator("[data-merge-saved]").waitFor({ timeout: pageTimeoutMs });
  return counts;
}
