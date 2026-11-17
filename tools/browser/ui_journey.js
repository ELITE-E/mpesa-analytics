// Steps through the real UI as a user would, shared by the owner's ui_run and the download
// measurement: choose a statement on /upload and wait for where the app lands, then move between
// screens with the app's own links, so the in-memory session stays.

const PROCEED = "Proceed to Analysis";

/**
 * Choose the statement on /upload, proceed, and wait for the summary or /recovery.
 *
 * Side effects: drives the page; the password, if any, is typed into the app's field only.
 *
 * @param {object} page The page.
 * @param {string} origin The app's origin.
 * @param {Buffer} pdfBytes The PDF.
 * @param {object} options How to import.Bash Re-measure the honest download
Bash Re-measure the honest download

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
  options;
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
