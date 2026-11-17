"use client";

import { useMemo } from "react";
import { BreakdownNav } from "@/components/analysis/breakdown-nav";
import { ErrorCard, LoadingCard } from "@/components/data-state";
import { ImportScope } from "@/components/import-scope";
import { AnalyticSplit, type SplitPanel } from "@/components/layout/analytic-split";
import { AgentsCard, CashHeader, DepositsNote, LargestWithdrawalsCard, WhereCashWentNote, WithdrawalCostCard } from "@/components/cash/cash-cards";
import { useSharedStatement } from "@/components/statement-data";
import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { cashFigures } from "@/lib/statement/cash";
import { toStatementRow } from "@/lib/statement/rows";

/**
 * The Cash area of one loaded import. Every figure comes from the rows (the
 * API has no withdrawal total): while they load, or when they fail
 * (T-LOADFAIL), a loading or error card with Try again stands in for the
 * header's figure and the cards; under T-UNVERIFIED the header shows R2.2's
 * wording and no figure. The two notes don't depend on figures and always
 * stay.
 */
function CashBody({ summary, analytics }: { summary: ImportSummary; analytics: AnalyticsResult }) {
  const shared = useSharedStatement();
  if (!shared?.transactions) throw new Error("CashArea needs a page that loads transactions");
  const rowsState = shared.transactions;
  const transactions = rowsState.status === "ready" ? rowsState.data : null;
  const figures = useMemo(
    () => cashFigures({ summary, analytics, rows: transactions ? transactions.map(toStatementRow) : null }),
    [summary, analytics, transactions],
  );
  const importId = summary.id;
  const { breakdown } = figures;
  const primary: SplitPanel[] = [{ order: 1, content: <WhereCashWentNote /> }];
  const inspector: SplitPanel[] = [{ order: 6, content: <DepositsNote importId={importId} /> }];

  if (!breakdown) {
    const state = rowsState.status === "error" ? <ErrorCard error={rowsState.error} onRetry={shared.reloadTransactions} /> : <LoadingCard label="Loading transactions…" />;
    primary.push({ order: 3, content: state });
    return <AnalyticSplit gapClassName="gap-space-md" primary={primary} inspector={inspector} />;
  }
  if (breakdown.status === "shown") {
    primary.push({ order: 3, content: <LargestWithdrawalsCard withdrawals={breakdown.withdrawals} withdrawalCount={breakdown.total.count} importId={importId} /> });
    inspector.unshift(
      { order: 2, content: <AgentsCard agents={breakdown.agents} importId={importId} /> },
      { order: 4, content: <WithdrawalCostCard charges={breakdown.charges} importId={importId} /> },
    );
  }
  return (
    <>
      <CashHeader breakdown={breakdown} importId={importId} />
      <AnalyticSplit gapClassName="gap-space-md" primary={primary} inspector={inspector} />
    </>
  );
}

/**
 * IA prototype: the Cash area ("What happened with cash withdrawals?") for
 * import `importId` (null: the latest), from the page's shared statement
 * data (the page loads its transactions). The area switcher sits above it;
 * loading, error and "no imports" states of the import itself are
 * ImportScope's.
 */
export function CashArea({ importId }: { importId: number | null }) {
  return (
    <>
      <BreakdownNav active="cash" importId={importId} />
      <ImportScope importId={importId}>{({ summary, analytics }) => <CashBody summary={summary} analytics={analytics} />}</ImportScope>
    </>
  );
}
