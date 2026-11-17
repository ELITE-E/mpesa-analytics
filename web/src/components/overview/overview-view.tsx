"use client";

import { useMemo, type ReactNode } from "react";
import { ErrorCard, LoadingCard } from "@/components/data-state";
import { ImportScope } from "@/components/import-scope";
import { AnalyticSplit } from "@/components/layout/analytic-split";
import { CashFlowBridgeCard } from "@/components/overview/cash-flow-bridge-card";
import { KeyEventsCard } from "@/components/overview/key-events-card";
import { OutflowAllocationCard } from "@/components/overview/outflow-allocation-card";
import { PeriodRibbon } from "@/components/overview/period-ribbon";
import { ReviewStatusCard } from "@/components/overview/review-status-card";
import { StoryCard } from "@/components/overview/story-card";
import { WhereFromCard } from "@/components/overview/where-from-card";
import { useSharedStatement } from "@/components/statement-data";
import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { formatCount, formatPeriod } from "@/lib/format";
import { overviewFigures } from "@/lib/statement/overview";
import { toStatementRow } from "@/lib/statement/rows";

/**
 * Overview of one loaded import: the API's figures straight away, and the
 * row-derived ones (bridge, allocation, sources, unclassified amounts, the
 * largest inflow and send) once the page's shared transaction load arrives.
 * While the rows load, or when they fail (T-LOADFAIL), a loading or error
 * card with Try again takes the row-derived cards' place; the period, the
 * story, the review count and the API's largest purchases stay.
 */
function OverviewBody({ summary, analytics }: { summary: ImportSummary; analytics: AnalyticsResult }) {
  const shared = useSharedStatement();
  if (!shared?.transactions) throw new Error("OverviewView needs a page that loads transactions");
  const rowsState = shared.transactions;
  const transactions = rowsState.status === "ready" ? rowsState.data : null;
  const figures = useMemo(
    () => overviewFigures({ summary, analytics, rows: transactions ? transactions.map(toStatementRow) : null }),
    [summary, analytics, transactions],
  );
  const importId = summary.id;
  const period = formatPeriod(summary.period_start, summary.period_end);

  let rowCards: { bridge: ReactNode; allocation: ReactNode; sources: ReactNode };
  if (figures.bridge && figures.allocation && figures.sources) {
    rowCards = {
      bridge: <CashFlowBridgeCard figures={{ ...figures, bridge: figures.bridge }} importId={importId} />,
      allocation: <OutflowAllocationCard allocation={figures.allocation} moneyOutCents={figures.moneyOut.cents} importId={importId} />,
      sources: <WhereFromCard sources={figures.sources} moneyInCents={figures.moneyIn.cents} importId={importId} />,
    };
  } else {
    const state =
      rowsState.status === "error" ? (
        <ErrorCard error={rowsState.error} onRetry={shared.reloadTransactions} />
      ) : (
        <LoadingCard label="Loading transactions…" />
      );
    rowCards = { bridge: state, allocation: null, sources: null };
  }

  return (
    <>
      <PeriodRibbon range={period} badge={formatCount(figures.lineCount, "statement line")} />
      <AnalyticSplit
        gapClassName="gap-space-md"
        primary={[
          { order: 1, content: <StoryCard period={period} figures={figures} importId={importId} /> },
          { order: 2, content: rowCards.bridge },
          ...(rowCards.allocation ? [{ order: 3, content: rowCards.allocation }] : []),
        ]}
        inspector={[
          ...(rowCards.sources ? [{ order: 4, content: rowCards.sources }] : []),
          { order: 5, content: <ReviewStatusCard review={figures.review} lineCount={figures.lineCount} importId={importId} /> },
          { order: 6, content: <KeyEventsCard largest={figures.largest} lineCount={figures.lineCount} importId={importId} /> },
        ]}
      />
    </>
  );
}

/**
 * IA prototype: Overview answers "What happened to my money?" for import
 * `importId` (null: the latest), from the page's shared statement data (the
 * Overview page loads its transactions). Loading, error and "no imports"
 * states of the import itself are ImportScope's.
 */
export function OverviewView({ importId }: { importId: number | null }) {
  return <ImportScope importId={importId}>{({ summary, analytics }) => <OverviewBody summary={summary} analytics={analytics} />}</ImportScope>;
}
