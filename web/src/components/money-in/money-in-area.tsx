"use client";

import { useMemo } from "react";
import { BreakdownNav } from "@/components/analysis/breakdown-nav";
import { ErrorCard, LoadingCard } from "@/components/data-state";
import { ImportScope } from "@/components/import-scope";
import { AnalyticSplit, type SplitPanel } from "@/components/layout/analytic-split";
import { BusinessNote, LargestPaymentsCard, MoneyInHeader, MonthsNote, SourcesCard } from "@/components/money-in/money-in-cards";
import { useSharedStatement } from "@/components/statement-data";
import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { moneyInFigures } from "@/lib/statement/money-in";
import { toStatementRow } from "@/lib/statement/rows";

/**
 * The Money In area of one loaded import. The header always has the API's
 * money in; with the rows it adds the sources and the largest payments.
 * While the rows load, or when they fail (T-LOADFAIL), a loading or error
 * card with Try again takes the row figures' place; under T-UNVERIFIED they
 * are withheld. The two notes don't depend on figures and always stay.
 */
function MoneyInBody({ summary, analytics }: { summary: ImportSummary; analytics: AnalyticsResult }) {
  const shared = useSharedStatement();
  if (!shared?.transactions) throw new Error("MoneyInArea needs a page that loads transactions");
  const rowsState = shared.transactions;
  const transactions = rowsState.status === "ready" ? rowsState.data : null;
  const figures = useMemo(
    () => moneyInFigures({ summary, analytics, rows: transactions ? transactions.map(toStatementRow) : null }),
    [summary, analytics, transactions],
  );
  const importId = summary.id;
  const { breakdown } = figures;
  const primary: SplitPanel[] = [];
  const inspector: SplitPanel[] = [
    { order: 2, content: <BusinessNote /> },
    { order: 4, content: <MonthsNote /> },
  ];

  if (!breakdown) {
    const state = rowsState.status === "error" ? <ErrorCard error={rowsState.error} onRetry={shared.reloadTransactions} /> : <LoadingCard label="Loading transactions…" />;
    primary.push({ order: 1, content: state });
  } else if (breakdown.status === "shown") {
    primary.push(
      { order: 1, content: <SourcesCard sources={breakdown.sources} importId={importId} /> },
      { order: 3, content: <LargestPaymentsCard payments={breakdown.payments} paymentCount={breakdown.count} importId={importId} /> },
    );
  }
  return (
    <>
      <MoneyInHeader api={figures.api} breakdown={breakdown} importId={importId} />
      <AnalyticSplit gapClassName="gap-space-md" primary={primary} inspector={inspector} />
    </>
  );
}

/**
 * IA prototype: the Money In area ("Where did my money come from?") for
 * import `importId` (null: the latest), from the page's shared statement
 * data (the page loads its transactions). The area switcher sits above it;
 * loading, error and "no imports" states of the import itself are
 * ImportScope's.
 */
export function MoneyInArea({ importId }: { importId: number | null }) {
  return (
    <>
      <BreakdownNav active="money-in" importId={importId} />
      <ImportScope importId={importId}>{({ summary, analytics }) => <MoneyInBody summary={summary} analytics={analytics} />}</ImportScope>
    </>
  );
}
