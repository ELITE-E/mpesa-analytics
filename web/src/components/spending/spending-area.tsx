"use client";

import { useMemo } from "react";
import { BreakdownNav } from "@/components/analysis/breakdown-nav";
import { ErrorCard, LoadingCard } from "@/components/data-state";
import { ImportScope } from "@/components/import-scope";
import { AnalyticSplit, type SplitPanel } from "@/components/layout/analytic-split";
import { RankedMerchantsCard } from "@/components/spending/ranked-merchants-card";
import { ReceiptPreviewCard } from "@/components/spending/receipt-preview-card";
import { RecurringUtilitiesCard } from "@/components/spending/recurring-utilities-card";
import { ChannelsCard, NotCountedCard, SpendingHeader } from "@/components/spending/spending-summary-cards";
import { useSharedStatement } from "@/components/statement-data";
import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { formatPeriod } from "@/lib/format";
import { toStatementRow } from "@/lib/statement/rows";
import { spendingFigures } from "@/lib/statement/spending";

/**
 * The Spending area of one loaded import. With its rows: the header, the
 * channels, merchants and receipts, what isn't counted, and the API's
 * recurring payments. While the rows load, or when they fail (T-LOADFAIL), a
 * loading or error card with Try again takes the row figures' place and the
 * recurring payments (API values) stay. Under T-UNVERIFIED only the receipts
 * (rows as stored) and the recurring payments remain beside the header.
 */
function SpendingBody({ summary, analytics }: { summary: ImportSummary; analytics: AnalyticsResult }) {
  const shared = useSharedStatement();
  if (!shared?.transactions) throw new Error("SpendingArea needs a page that loads transactions");
  const rowsState = shared.transactions;
  const transactions = rowsState.status === "ready" ? rowsState.data : null;
  const figures = useMemo(
    () => spendingFigures({ summary, analytics, rows: transactions ? transactions.map(toStatementRow) : null }),
    [summary, analytics, transactions],
  );
  const importId = summary.id;
  const recurring = { order: 4, content: <RecurringUtilitiesCard recurring={figures.recurring} importId={importId} /> };

  if (!figures.breakdown || !figures.receipts) {
    const state = rowsState.status === "error" ? <ErrorCard error={rowsState.error} onRetry={shared.reloadTransactions} /> : <LoadingCard label="Loading transactions…" />;
    return <AnalyticSplit gapClassName="gap-space-md" primary={[{ order: 1, content: state }]} inspector={[recurring]} />;
  }

  const { breakdown, receipts } = figures;
  const primary: SplitPanel[] = [];
  const inspector: SplitPanel[] = [recurring];
  if (breakdown.status === "shown") {
    primary.push({ order: 1, content: <ChannelsCard breakdown={breakdown} importId={importId} /> });
    primary.push({ order: 3, content: <RankedMerchantsCard merchants={breakdown.merchants} importId={importId} /> });
    inspector.unshift({ order: 2, content: <NotCountedCard notCounted={breakdown.notCounted} importId={importId} /> });
  }
  primary.push({ order: 5, content: <ReceiptPreviewCard receipts={receipts} importId={importId} /> });
  return (
    <>
      <SpendingHeader breakdown={breakdown} period={formatPeriod(summary.period_start, summary.period_end)} importId={importId} />
      <AnalyticSplit gapClassName="gap-space-md" primary={primary} inspector={inspector} />
    </>
  );
}

/**
 * IA prototype: the Spending area ("What did I consume?") of import
 * `importId` (null: the latest), from the page's shared statement data (the
 * page loads its transactions). The area switcher sits above it; loading,
 * error and "no imports" states of the import itself are ImportScope's.
 */
export function SpendingArea({ importId }: { importId: number | null }) {
  return (
    <>
      <BreakdownNav active="spending" importId={importId} />
      <ImportScope importId={importId}>{({ summary, analytics }) => <SpendingBody summary={summary} analytics={analytics} />}</ImportScope>
    </>
  );
}
