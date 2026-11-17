"use client";

import { useMemo } from "react";
import { BreakdownNav } from "@/components/analysis/breakdown-nav";
import { ErrorCard, LoadingCard } from "@/components/data-state";
import { CausesCard, CountedOnceNote, ExciseNote, FeesHeader, FreeNote, LargestChargesCard } from "@/components/fees/fees-area-cards";
import { ImportScope } from "@/components/import-scope";
import { AnalyticSplit, type SplitPanel } from "@/components/layout/analytic-split";
import { useSharedStatement } from "@/components/statement-data";
import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { feesFigures } from "@/lib/statement/fees";
import { toStatementRow } from "@/lib/statement/rows";

/**
 * The Fees area of one loaded import. The header always has the API's
 * charges paid; with the rows it adds the causes, the largest charges and
 * the payments without one. While the rows load, or when they fail
 * (T-LOADFAIL), a loading or error card with Try again takes the row
 * figures' place; under T-UNVERIFIED they are withheld. The two notes that
 * don't depend on figures always stay.
 */
function FeesBody({ summary, analytics }: { summary: ImportSummary; analytics: AnalyticsResult }) {
  const shared = useSharedStatement();
  if (!shared?.transactions) throw new Error("FeesArea needs a page that loads transactions");
  const rowsState = shared.transactions;
  const transactions = rowsState.status === "ready" ? rowsState.data : null;
  const figures = useMemo(
    () => feesFigures({ summary, analytics, rows: transactions ? transactions.map(toStatementRow) : null }),
    [summary, analytics, transactions],
  );
  const importId = summary.id;
  const { breakdown } = figures;
  const primary: SplitPanel[] = [];
  const inspector: SplitPanel[] = [
    { order: 2, content: <CountedOnceNote /> },
    { order: 5, content: <ExciseNote /> },
  ];

  if (!breakdown) {
    const state = rowsState.status === "error" ? <ErrorCard error={rowsState.error} onRetry={shared.reloadTransactions} /> : <LoadingCard label="Loading transactions…" />;
    primary.push({ order: 1, content: state });
  } else if (breakdown.status === "shown") {
    primary.push(
      { order: 1, content: <CausesCard causes={breakdown.causes} importId={importId} /> },
      { order: 3, content: <LargestChargesCard charges={breakdown.largest} chargeCount={breakdown.total.count} importId={importId} /> },
    );
    inspector.splice(1, 0, { order: 4, content: <FreeNote free={breakdown.free} /> });
  }
  return (
    <>
      <FeesHeader api={figures.api} breakdown={breakdown} importId={importId} />
      <AnalyticSplit gapClassName="gap-space-md" primary={primary} inspector={inspector} />
    </>
  );
}

/**
 * IA prototype: the Fees area ("What did moving my money cost?"), replacing
 * the Fees screen in Breakdown, for import `importId` (null: the latest),
 * from the page's shared statement data (the page loads its transactions).
 * The area switcher sits above it; loading, error and "no imports" states of
 * the import itself are ImportScope's.
 */
export function FeesArea({ importId }: { importId: number | null }) {
  return (
    <>
      <BreakdownNav active="fees" importId={importId} />
      <ImportScope importId={importId}>{({ summary, analytics }) => <FeesBody summary={summary} analytics={analytics} />}</ImportScope>
    </>
  );
}
