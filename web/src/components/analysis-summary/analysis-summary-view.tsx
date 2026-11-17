"use client";

import { CashFlowSnapshotCard } from "@/components/analysis-summary/cash-flow-snapshot-card";
import { ExploreNextCard } from "@/components/analysis-summary/explore-next-card";
import { LimitationsCard } from "@/components/analysis-summary/limitations-card";
import { SummaryHero } from "@/components/analysis-summary/summary-hero";
import { ErrorCard, LoadingCard } from "@/components/data-state";
import { ImportScope, type ImportWithAnalytics } from "@/components/import-scope";
import { getAllTransactions } from "@/lib/api";
import { formatCount, formatPeriod } from "@/lib/format";
import { withImport } from "@/lib/import-link";
import { useApiData } from "@/lib/use-api";
import { verificationTokenFor } from "@/lib/upload-flow";
import { StatementChecksForImport } from "@/components/analysis-summary/statement-checks-card";

/**
 * The sentence under the summary heading: the statement period was imported
 * and saved, plus how many of its transactions were already saved by an
 * earlier import and therefore not duplicated. It claims nothing the import
 * does not do (no reconciliation is performed).
 */
export function describeImport({ summary }: Pick<ImportWithAnalytics, "summary">) {
  const reused = summary.previously_imported_transaction_count;
  const base = `Your statement for ${formatPeriod(summary.period_start, summary.period_end)} has been read on this device. Nothing was sent anywhere or stored.`;
  if (reused === 0) return base;
  if (reused === summary.transaction_count) {
    return `${base} You had imported every one of these transactions before, so none were duplicated.`;
  }
  return `${base} ${formatCount(reused, "transaction")} had been imported before and were not duplicated.`;
}

function Limitations({ importId, transactionCount }: { importId: number; transactionCount: number }) {
  const { state, reload } = useApiData(() => getAllTransactions(importId), `ledger:${importId}`);
  if (state.status === "loading") return <LoadingCard label="Loading unclassified records…" />;
  if (state.status === "error") return <ErrorCard error={state.error} onRetry={reload} />;
  return (
    <LimitationsCard
      importId={importId}
      transactionCount={transactionCount}
      unclassified={state.data.filter((t) => t.event_type === "UNCLASSIFIED")}
    />
  );
}

// The outcome of one import, opened after a successful upload.
export function AnalysisSummaryView({ importId }: { importId: number | null }) {
  return (
    <ImportScope importId={importId}>
      {(current) => {
        const { summary, analytics } = current;
        return (
          <>
            <SummaryHero
              description={describeImport(current)}
              verificationCode={verificationTokenFor(summary.id)}
            />
            <StatementChecksForImport importId={summary.id} />
            <CashFlowSnapshotCard
              period={`Period: ${formatPeriod(summary.period_start, summary.period_end)}`}
              itemCount={formatCount(summary.transaction_count, "Item")}
              cashFlow={analytics.cash_flow}
              overviewHref={withImport("/overview", summary.id)}
            />
            {summary.unclassified_transaction_count > 0 && (
              <Limitations importId={summary.id} transactionCount={summary.transaction_count} />
            )}
            <ExploreNextCard importId={summary.id} />
          </>
        );
      }}
    </ImportScope>
  );
}
