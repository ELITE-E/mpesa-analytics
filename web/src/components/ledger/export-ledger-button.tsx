"use client";

import type { ReactNode } from "react";
import { exportNotice } from "@/content/ledger";
import { downloadCsv } from "@/lib/download-csv";
import { LEDGER_CSV_HEADER, ledgerCsvRows } from "@/lib/ledger-csv";
import type { StatementRow } from "@/lib/statement/rows";

/**
 * Downloads `rows` (the rows of the scope in view, never a default set) as
 * the Ledger CSV (lib/ledger-csv.ts): one line per statement row, so its
 * money columns add up to the scope's totals. Below it, the notice that the file is not
 * encrypted (CP10a item 3).
 */
export function ExportLedgerButton({
  rows,
  fileName,
  className,
  children,
}: {
  rows: StatementRow[];
  fileName: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        data-export-csv=""
        onClick={() => downloadCsv(fileName, LEDGER_CSV_HEADER, ledgerCsvRows(rows))}
        className={className}
      >
        {children}
      </button>
      <p className="font-body text-[11px] text-on-surface-variant" data-csv-notice="">
        {exportNotice}
      </p>
    </>
  );
}
