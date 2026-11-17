"use client";

import { useSearchParams } from "next/navigation";
import { LedgerExplorer } from "@/components/ledger/ledger-explorer";
import { ledgerRequest, type SearchParams } from "@/lib/ledger-link";

/**
 * The Ledger for the URL's `?scope=`, `?from=` and legacy parameters, read in the browser: a
 * static export has no server to read them (CP8b). The same `ledgerRequest` decides what is shown.
 *
 * @param props.importId The statement shown; null for the session's latest.
 * @returns The ledger explorer for that request.
 */
export function LedgerFromUrl({ importId }: { importId: number | null }) {
  const searchParams = useSearchParams();
  const params: SearchParams = {};
  for (const name of new Set(searchParams.keys())) {
    const values = searchParams.getAll(name);
    params[name] = values.length === 1 ? values[0] : values;
  }
  const request = ledgerRequest(params);
  return (
    <LedgerExplorer
      key={`${request.scopeId}|${request.from}|${request.unrecognised}`}
      request={request}
      importId={importId}
    />
  );
}
