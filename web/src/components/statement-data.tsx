"use client";

// Page-level statement data (IA migration Stage 4b): one load of the import's
// summary per page, shared by its shell (StoryPeriod) and body (ImportScope),
// then one load each of its analytics and, on pages that ask for them, its
// transactions. Loading, error and empty states stay with the existing
// components (ImportScope, data-state.tsx) that render them.

import { createContext, useContext, type ReactNode } from "react";
import type { ImportWithAnalytics } from "@/components/import-scope";
import {
  getAllTransactions,
  getAnalytics,
  getImportOrLatest,
  type AnalyticsResult,
  type ImportSummary,
  type Transaction,
} from "@/lib/api";
import { assertRowsIntact } from "@/lib/statement/integrity";
import { useApiData, type LoadState } from "@/lib/use-api";

/**
 * The requested import (or, without one, the user's most recent) and its
 * persisted analytics; null when the user has no imports. Rejects with the
 * API's error, e.g. 404 for an import that is not the user's.
 */
export async function loadImportWithAnalytics(importId: number | null): Promise<ImportWithAnalytics | null> {
  const summary = await getImportOrLatest(importId);
  if (!summary) return null;
  const snapshot = await getAnalytics(summary.id);
  return { summary, analytics: snapshot.result };
}

/**
 * Every transaction of the import `summary` describes, verified complete:
 * getAllTransactions enforces H-1..H-3 while paging, and the rows must then
 * match the summary and be well formed (H-4, H-5). Rejects with the
 * "incomplete_transactions" error otherwise, never with partial rows.
 */
export async function loadIntactTransactions(summary: ImportSummary): Promise<Transaction[]> {
  const rows = await getAllTransactions(summary.id);
  assertRowsIntact(rows, summary);
  return rows;
}

/** What a page has loaded about its import, and how to retry each part. */
export type SharedStatement = {
  importId: number | null;
  /** The import's summary alone: what the shell names, whatever happens to its analytics. */
  summary: LoadState<ImportSummary | null>;
  /** The summary with its analytics, as ImportScope renders them. */
  statement: LoadState<ImportWithAnalytics | null>;
  /** Retry whichever part of `statement` failed. */
  reloadStatement: () => void;
  /** null on pages that don't load transactions. */
  transactions: LoadState<Transaction[]> | null;
  reloadTransactions: () => void;
};

const SharedStatementContext = createContext<SharedStatement | null>(null);

/**
 * A load that needs the import first (its analytics or transactions), as
 * consumers see it: loading until the import is known and the load has
 * arrived. While the import is still loading, the dependent load resolves to
 * null without a request, and that null (also left over for a moment when the
 * import becomes known) never means "nothing".
 */
function afterSummary<T>(summary: LoadState<ImportSummary | null>, dependent: LoadState<T | null>): LoadState<T> {
  if (summary.status !== "ready" || summary.data === null) return { status: "loading" };
  if (dependent.status === "ready" && dependent.data === null) return { status: "loading" };
  return dependent as LoadState<T>;
}

/**
 * The summary and analytics together, for ImportScope: the summary's own
 * loading, error or "no imports" state first, then the analytics' state, then
 * both.
 */
function withAnalytics(
  summary: LoadState<ImportSummary | null>,
  analytics: LoadState<AnalyticsResult | null>,
): LoadState<ImportWithAnalytics | null> {
  if (summary.status !== "ready") return summary;
  if (summary.data === null) return { status: "ready", data: null };
  const loaded = afterSummary(summary, analytics);
  return loaded.status === "ready" ? { status: "ready", data: { summary: summary.data, analytics: loaded.data } } : loaded;
}

/**
 * Loads import `importId` (null: the latest) once for the whole page and
 * shares it with every StoryPeriod and ImportScope inside, so the shell and
 * the body make one summary request between them and always show the same
 * import. Its analytics are loaded next, separately, so a failed analytics
 * request never costs the shell the import's period. With
 * `withTransactions`, the import's transactions are loaded once too, also
 * separately, so a failed row load withholds only what depends on the rows
 * while the summary and analytics stay visible (plan rev2 R2.2 T-LOADFAIL).
 */
export function StatementDataProvider({
  importId,
  withTransactions = false,
  children,
}: {
  importId: number | null;
  withTransactions?: boolean;
  children: ReactNode;
}) {
  const summaryLoad = useApiData(() => getImportOrLatest(importId), `statement-summary:${importId}`);
  const summary = summaryLoad.state.status === "ready" ? summaryLoad.state.data : null;
  const analyticsLoad = useApiData(
    () => (summary ? getAnalytics(summary.id).then((snapshot) => snapshot.result) : Promise.resolve(null)),
    `statement-analytics:${summary?.id ?? "pending"}`,
  );
  const rows = useApiData(
    () => (withTransactions && summary ? loadIntactTransactions(summary) : Promise.resolve(null)),
    `statement-rows:${withTransactions ? summary?.id ?? "pending" : "not-loaded"}`,
  );
  const shared: SharedStatement = {
    importId,
    summary: summaryLoad.state,
    statement: withAnalytics(summaryLoad.state, analyticsLoad.state),
    reloadStatement: summaryLoad.state.status === "error" ? summaryLoad.reload : analyticsLoad.reload,
    transactions: withTransactions ? afterSummary(summaryLoad.state, rows.state) : null,
    reloadTransactions: rows.reload,
  };
  return <SharedStatementContext.Provider value={shared}>{children}</SharedStatementContext.Provider>;
}

/** The page's shared statement data, or null outside a StatementDataProvider. */
export function useSharedStatement() {
  return useContext(SharedStatementContext);
}
