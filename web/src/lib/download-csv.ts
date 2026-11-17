/** CSV text: every cell quoted, quotes doubled, so commas, quotes and newlines survive. */
export function csvText(header: string[], rows: string[][]) {
  const quote = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
  return [header, ...rows].map((row) => row.map(quote).join(",")).join("\n");
}

/** Downloads rows as a CSV file (see csvText). */
export function downloadCsv(fileName: string, header: string[], rows: string[][]) {
  const url = URL.createObjectURL(new Blob([csvText(header, rows)], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
