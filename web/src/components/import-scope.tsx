"use client";

import type { ReactNode } from "react";
import { ErrorCard, LoadingCard, NoImportsCard } from "@/components/data-state";
import { loadImportWithAnalytics, useSharedStatement } from "@/components/statement-data";
import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { useApiData, type LoadState } from "@/lib/use-api";

export type ImportWithAnalytics = { summary: ImportSummary; analytics: AnalyticsResult };

type ScopeChildren = (current: ImportWithAnalytics) => ReactNode;

/** The loading, error and empty states of an import load, or `children` once it has loaded. */
function ImportScopeState({
  state,
  reload,
  children,
}: {
  state: LoadState<ImportWithAnalytics | null>;
  reload: () => void;
  children: ScopeChildren;
}) {
  if (state.status === "loading") return <LoadingCard />;
  if (state.status === "error") return <ErrorCard error={state.error} onRetry={reload} />;
  if (state.data === null) return <NoImportsCard />;
  return <>{children(state.data)}</>;
}

/** An ImportScope with no page-level data to share: it loads the import itself. */
function SelfLoadingImportScope({ importId, children }: { importId: number | null; children: ScopeChildren }) {
  const { state, reload } = useApiData(() => loadImportWithAnalytics(importId), `import:${importId}`);
  return (
    <ImportScopeState state={state} reload={reload}>
      {children}
    </ImportScopeState>
  );
}

/**
 * An import and its persisted analytics, showing loading, error and empty
 * states, and rendering `children` once they are available. Screens opened
 * without `?import=<id>` show the user's most recent import. Inside a
 * StatementDataProvider (every story screen) it renders the page's shared
 * load, so the page asks for the import once; elsewhere (the analysis
 * summary) it loads import `importId` itself.
 */
export function ImportScope({ importId, children }: { importId: number | null; children: ScopeChildren }) {
  const shared = useSharedStatement();
  if (shared) {
    return (
      <ImportScopeState state={shared.statement} reload={shared.reloadStatement}>
        {children}
      </ImportScopeState>
    );
  }
  return <SelfLoadingImportScope importId={importId}>{children}</SelfLoadingImportScope>;
}
