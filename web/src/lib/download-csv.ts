// Characters a spreadsheet reads as the start of a formula (CSV injection), and a plain number,
// which may start with + or - and stays a number.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const BYTE_ORDER_MARK = "\uFEFF";

/**
 * CSV text: every cell neutralised (see neutralised) and quoted, quotes doubled, so commas,
 * quotes and newlines survive.
 *
 * @param header The header cells.
 * @param rows The rows' cells.
 * @returns The text, lines joined by "\n", without a byte order mark.
 */
export function csvText(header: string[], rows: string[][]) {
  const quote = (cell: string) => `"${neutralised(cell).replaceAll('"', '""')}"`;
  return [header, ...rows].map((row) => row.map(quote).join(",")).join("\n");
}

/**
 * The downloaded file's text: a UTF-8 byte order mark, so spreadsheets read its text right, then
 * the CSV text.
 *
 * @param header The header cells.
 * @param rows The rows' cells.
 * @returns The file's text.
 */
export function csvFileText(header: string[], rows: string[][]) {
  return BYTE_ORDER_MARK + csvText(header, rows);
}

/**
 * A cell a spreadsheet cannot run: one starting with = + - @, a tab or a carriage return gets a
 * leading apostrophe, unless it is a plain number. Statement text is never trusted.
 *
 * @param cell The cell.
 * @returns The cell, neutralised if needed.
 */
export function neutralised(cell: string) {
  return FORMULA_START.test(cell) && !PLAIN_NUMBER.test(cell) ? `'${cell}` : cell;
}

/** Downloads rows as a CSV file (see csvFileText). The file is not encrypted; the screen says so. */
export function downloadCsv(fileName: string, header: string[], rows: string[][]) {
  const url = URL.createObjectURL(new Blob([csvFileText(header, rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
