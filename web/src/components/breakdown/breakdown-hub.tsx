"use client";

import { useMemo } from "react";
import { AddsUpCard, AreaCard, HubHeader } from "@/components/breakdown/hub-cards";
import { ErrorCard, LoadingCard } from "@/components/data-state";
import { Icon } from "@/components/icon";
import { ImportScope } from "@/components/import-scope";
import { AnalyticSplit } from "@/components/layout/analytic-split";
import { useSharedStatement } from "@/components/statement-data";
import { BREAKDOWN_AREAS, hub } from "@/content/breakdown";
import { hubFigures, type AreaFigure, type HubFigures, type OutflowArea } from "@/lib/statement/hub";
import { toStatementRow } from "@/lib/statement/rows";

/** A column heading of the hub ("Where money went" / "Where money came from"). */
function ColumnHeading({ icon, tone, children }: { icon: string; tone: string; children: string }) {
  return (
    <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-space-xs">
      <Icon name={icon} size={18} className={tone} />
      {children}
    </h2>
  );
}

/** The figure of area `id` from `figures`, or null while loading or withheld. Money in is the API's, with its inflow rows. */
function areaFigure(id: string, figures: HubFigures | null): AreaFigure | null {
  const shown = figures?.breakdown?.status === "shown" ? figures.breakdown : null;
  if (!figures || !shown) return null;
  if (id === "money-in") return { cents: figures.moneyIn.cents, count: shown.inflowCount, share: null, scopeId: figures.moneyIn.scopeId };
  return shown.areas[id as OutflowArea] ?? null;
}

/**
 * IA prototype: the Breakdown home's body for import `importId`. The six
 * areas are always there to open; once the import and its rows have loaded
 * (one load for the page) each shows its headline, money in sits beside
 * them, and the "adds up" card shows every outflow bucket adding back to
 * money out. Loading, error and "no imports" states of the import are
 * ImportScope's; the rows' own are a loading or retryable error card in
 * the "adds up" card's place (T-LOADFAIL). Under T-UNVERIFIED the figures
 * are withheld (Q-D9). Links that open screens keep the page's `importId`
 * (none: the latest import); figure doors open the import the figures came
 * from.
 */
export function BreakdownHub({ importId }: { importId: number | null }) {
  const shared = useSharedStatement();
  if (!shared?.transactions) throw new Error("BreakdownHub needs a page that loads transactions");
  const loaded = shared.statement.status === "ready" ? shared.statement.data : null;
  const rowsState = shared.transactions;
  const transactions = rowsState.status === "ready" ? rowsState.data : null;
  const figures = useMemo(
    () => (loaded ? hubFigures({ summary: loaded.summary, analytics: loaded.analytics, rows: transactions ? transactions.map(toStatementRow) : null }) : null),
    [loaded, transactions],
  );
  const doorImportId = loaded?.summary.id ?? importId;
  const out = BREAKDOWN_AREAS.filter((area) => area.id !== "money-in");
  const moneyIn = BREAKDOWN_AREAS.find((area) => area.id === "money-in");
  const shown = figures?.breakdown?.status === "shown" ? figures.breakdown : null;

  let addsUp = null;
  if (figures?.breakdown) addsUp = <AddsUpCard breakdown={figures.breakdown} moneyOut={figures.moneyOut} importId={doorImportId} />;
  else if (loaded) addsUp = rowsState.status === "error" ? <ErrorCard error={rowsState.error} onRetry={shared.reloadTransactions} /> : <LoadingCard label="Loading transactions…" />;

  return (
    <>
      <HubHeader figures={figures} importId={importId} doorImportId={doorImportId} />
      {!loaded && <ImportScope importId={importId}>{() => null}</ImportScope>}
      <AnalyticSplit
        gapClassName="gap-space-md"
        primary={[
          {
            order: 1,
            content: (
              <div className="flex flex-col gap-space-md">
                <ColumnHeading icon="north_east" tone="text-tertiary">
                  {hub.wentHeading}
                </ColumnHeading>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
                  {out.map((area) => (
                    <AreaCard key={area.id} area={area} figure={areaFigure(area.id, figures)} importId={importId} doorImportId={doorImportId} />
                  ))}
                </div>
              </div>
            ),
          },
        ]}
        inspector={[
          {
            order: 2,
            content: (
              <div className="flex flex-col gap-space-md">
                <ColumnHeading icon="south_west" tone="text-primary">
                  {hub.cameHeading}
                </ColumnHeading>
                {moneyIn && <AreaCard area={moneyIn} figure={areaFigure("money-in", figures)} linked={shown?.inflowVerified === true} importId={importId} doorImportId={doorImportId} />}
                {addsUp}
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
