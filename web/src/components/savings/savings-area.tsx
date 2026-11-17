"use client";

import { useMemo } from "react";
import { BreakdownNav } from "@/components/analysis/breakdown-nav";
import { ErrorCard, LoadingCard } from "@/components/data-state";
import { ImportScope } from "@/components/import-scope";
import { AnalyticSplit, type SplitPanel } from "@/components/layout/analytic-split";
import {
  LargestDepositsCard,
  LimitsNote,
  MonthsCard,
  NotSpendingNote,
  OtherSavingsNote,
  PlacesCard,
  SavingsHeader,
} from "@/components/savings/savings-cards";
import { useSharedStatement } from "@/components/statement-data";
import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { toStatementRow } from "@/lib/statement/rows";
import { savingsFigures } from "@/lib/statement/savings";

/**
 * The Savings area of one loaded import. The header always has the API's
 * total set aside; with the rows it adds the places, the months and the
 * largest deposits. While the rows load, or when they fail (T-LOADFAIL), a
 * loading or error card with Try again takes the row figures' place; under
 * T-UNVERIFIED they are withheld. The three notes don't depend on figures
 * and always stay. No export: the Savings slip is undecided (Q-P4).
 */
function SavingsBody({ summary, analytics }: { summary: ImportSummary; analytics: AnalyticsResult }) {
  const shared = useSharedStatement();
  if (!shared?.transactions) throw new Error("SavingsArea needs a page that loads transactions");
  const rowsState = shared.transactions;
  const transactions = rowsState.status === "ready" ? rowsState.data : null;
  const figures = useMemo(
    () => savingsFigures({ summary, analytics, rows: transactions ? transactions.map(toStatementRow) : null }),
    [summary, analytics, transactions],
  );
  const importId = summary.id;
  const { breakdown } = figures;
  const primary: SplitPanel[] = [{ order: 5, content: <LimitsNote /> }];
  const inspector: SplitPanel[] = [
    { order: 2, content: <NotSpendingNote /> },
    { order: 6, content: <OtherSavingsNote /> },
  ];

  if (!breakdown) {
    const state = rowsState.status === "error" ? <ErrorCard error={rowsState.error} onRetry={shared.reloadTransactions} /> : <LoadingCard label="Loading transactions…" />;
    primary.unshift({ order: 1, content: state });
  } else if (breakdown.status === "shown") {
    primary.unshift(
      { order: 1, content: <PlacesCard places={breakdown.places} importId={importId} /> },
      {
        order: 3,
        content: <LargestDepositsCard deposits={breakdown.deposits} depositCount={breakdown.total.count} depositCharges={breakdown.depositCharges} importId={importId} />,
      },
    );
    if (breakdown.months.length > 0) inspector.splice(1, 0, { order: 4, content: <MonthsCard months={breakdown.months} /> });
  }
  return (
    <>
      <SavingsHeader api={figures.api} breakdown={breakdown} importId={importId} />
      <AnalyticSplit gapClassName="gap-space-md" primary={primary} inspector={inspector} />
    </>
  );
}

/**
 * IA prototype: the Savings & Investments area ("How much did I set
 * aside?"), replacing Investments, for import `importId` (null: the latest),
 * from the page's shared statement data (the page loads its transactions).
 * The area switcher sits above it; loading, error and "no imports" states of
 * the import itself are ImportScope's.
 */
export function SavingsArea({ importId }: { importId: number | null }) {
  return (
    <>
      <BreakdownNav active="savings" importId={importId} />
      <ImportScope importId={importId}>{({ summary, analytics }) => <SavingsBody summary={summary} analytics={analytics} />}</ImportScope>
    </>
  );
}
