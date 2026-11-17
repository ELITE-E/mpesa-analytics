"use client";

import { useMemo } from "react";
import { BreakdownNav } from "@/components/analysis/breakdown-nav";
import { ErrorCard, LoadingCard } from "@/components/data-state";
import { ImportScope } from "@/components/import-scope";
import { AnalyticSplit, type SplitPanel } from "@/components/layout/analytic-split";
import {
  DirectionsCard,
  LargestSendsCard,
  OwnTransferNote,
  PeopleHeader,
  PeopleListCard,
  PurposeNote,
  SendCostCard,
} from "@/components/people/people-cards";
import { useSharedStatement } from "@/components/statement-data";
import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { peopleFigures } from "@/lib/statement/people";
import { toStatementRow } from "@/lib/statement/rows";

/**
 * The People area of one loaded import. The header always has the API's
 * sent and received totals; with the rows it adds the people, both
 * directions, the largest sends and what sending cost. While the rows load,
 * or when they fail (T-LOADFAIL), a loading or error card with Try again
 * takes the row figures' place; under T-UNVERIFIED they are withheld. The
 * two notes don't depend on figures and always stay.
 */
function PeopleBody({ summary, analytics }: { summary: ImportSummary; analytics: AnalyticsResult }) {
  const shared = useSharedStatement();
  if (!shared?.transactions) throw new Error("PeopleArea needs a page that loads transactions");
  const rowsState = shared.transactions;
  const transactions = rowsState.status === "ready" ? rowsState.data : null;
  const figures = useMemo(
    () => peopleFigures({ summary, analytics, rows: transactions ? transactions.map(toStatementRow) : null }),
    [summary, analytics, transactions],
  );
  const importId = summary.id;
  const { breakdown } = figures;
  const primary: SplitPanel[] = [{ order: 1, content: <PurposeNote /> }];
  const inspector: SplitPanel[] = [{ order: 6, content: <OwnTransferNote /> }];

  if (!breakdown) {
    const state = rowsState.status === "error" ? <ErrorCard error={rowsState.error} onRetry={shared.reloadTransactions} /> : <LoadingCard label="Loading transactions…" />;
    primary.push({ order: 3, content: state });
  } else if (breakdown.status === "shown") {
    primary.push({ order: 3, content: <PeopleListCard people={breakdown.people} importId={importId} /> });
    primary.push({ order: 5, content: <LargestSendsCard sends={breakdown.largestSends} sendCount={breakdown.sent.count} importId={importId} /> });
    inspector.unshift(
      { order: 2, content: <DirectionsCard breakdown={breakdown} importId={importId} /> },
      { order: 4, content: <SendCostCard sendCharges={breakdown.sendCharges} importId={importId} /> },
    );
  }
  return (
    <>
      <PeopleHeader api={figures.api} breakdown={breakdown} importId={importId} />
      <AnalyticSplit gapClassName="gap-space-md" primary={primary} inspector={inspector} />
    </>
  );
}

/**
 * IA prototype: the People area ("How much money moved between me and other
 * people?"), replacing Transfers, for import `importId` (null: the latest),
 * from the page's shared statement data (the page loads its transactions).
 * The area switcher sits above it; loading, error and "no imports" states of
 * the import itself are ImportScope's.
 */
export function PeopleArea({ importId }: { importId: number | null }) {
  return (
    <>
      <BreakdownNav active="people" importId={importId} />
      <ImportScope importId={importId}>{({ summary, analytics }) => <PeopleBody summary={summary} analytics={analytics} />}</ImportScope>
    </>
  );
}
