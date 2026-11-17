"use client";

import { useSharedStatement } from "@/components/statement-data";
import type { ImportSummary } from "@/lib/api";
import { formatPeriod } from "@/lib/format";

/**
 * The statement a story screen shows, as its shell names it: the import's
 * period once its summary has loaded; otherwise (loading, failed, or no
 * imports) "Import #id" for a requested import or "Latest import", so no
 * period is ever shown that the API did not report.
 */
export function storyPeriodLabel(importId: number | null, summary: ImportSummary | null) {
  if (summary) return formatPeriod(summary.period_start, summary.period_end);
  return importId ? `Import #${importId}` : "Latest import";
}

/**
 * The current story screen's statement label (see storyPeriodLabel), from the
 * page's shared statement data (StatementDataProvider), so the shell names
 * exactly the import the body shows and makes no request of its own. It needs
 * only the summary, so a failed analytics load doesn't cost it the period.
 * Load errors are left to the body, which shows them; the label keeps its
 * fallback.
 */
export function StoryPeriod() {
  const shared = useSharedStatement();
  const summary = shared?.summary.status === "ready" ? shared.summary.data : null;
  return <>{storyPeriodLabel(shared?.importId ?? null, summary)}</>;
}
