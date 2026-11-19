"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { CountsAsPill, foldedChargeCents, lineName, TxnRow } from "@/components/analysis/txn-row";
import { ErrorCard, LoadingCard } from "@/components/data-state";
import { Icon } from "@/components/icon";
import { ImportScope } from "@/components/import-scope";
import { PeriodRibbon } from "@/components/overview/period-ribbon";
import { sheetDialogClasses } from "@/components/layout/sheet-dialog";
import { ExportLedgerButton } from "@/components/ledger/export-ledger-button";
import { ReceiptDetail } from "@/components/ledger/receipt-detail";
import { ScopeBanner, type ScopeTotals } from "@/components/ledger/scope-banner";
import { ledgerCsvFileName } from "@/lib/ledger-csv";
import { useSharedStatement } from "@/components/statement-data";
import { BUCKET_LABELS, BUCKET_STYLE, bucketQuestion, channelQuestion, chargeCauseLabel, chargeCauseQuestion, ledger, NAMED_SCOPE_COPY } from "@/content/ledger";
import { CHANNEL_COPY } from "@/content/spending";
import type { AnalyticsResult, ImportSummary, Transaction } from "@/lib/api";
import { formatCount, formatDateTime, formatKes, formatPeriod } from "@/lib/format";
import { ledgerHref, type LedgerRequest } from "@/lib/ledger-link";
import { linkCharges } from "@/lib/statement/charges";
import { NO_ENTITY } from "@/lib/statement/groups";
import { ledgerLines, type LedgerLine } from "@/lib/statement/ledger-lines";
import { toCents, toStatementRow, type BucketId, type StatementRow } from "@/lib/statement/rows";
import { resolveLedgerScope, scopeFigureCents, type LedgerScope, type SpendingChannel } from "@/lib/statement/scopes";

/** Lines revealed at first and by each "Show more" (IA prototype). */
const PAGE = 25;

/** The named views offered beside every scope (decision Q-R2's vocabulary). */
const VIEWS: { id: string | null; label: string }[] = [
  { id: null, label: "All" },
  { id: "fees", label: "Charges" },
  { id: "investments", label: "Investments" },
  { id: "unclassified", label: "Not yet classified" },
];

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

/** "2024-07-28" → "Sunday, 28 Jul 2024", for the mobile day groups. */
function dayHeading(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return `${WEEKDAY.format(date)}, ${date.getUTCDate()} ${MONTH.format(date)} ${date.getUTCFullYear()}`;
}

/** Lines grouped by statement day in their order; lines with an unreadable time form their own group. */
function groupByDay(lines: LedgerLine[]) {
  const groups = new Map<string, LedgerLine[]>();
  for (const line of lines) {
    const key = line.row.completedAt?.date ?? "";
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return [...groups.entries()].map(([date, dayLines]) => ({ heading: date ? dayHeading(date) : "Date not readable", lines: dayLines }));
}

/** A line's time for the cards: "HH:MM", or the raw text when the time is unreadable. */
function lineTime(line: LedgerLine) {
  return line.row.completedAt ? line.row.completedAt.time.slice(0, 5) : line.row.source.completion_time;
}

/** Whether a line matches the search text (receipt, entity, statement text or what it counts as). */
function matchesQuery(line: LedgerLine, needle: string) {
  if (!needle) return true;
  const { row } = line;
  return [row.receiptNo, row.entity, row.source.details, BUCKET_LABELS[row.bucket]].join(" ").toLowerCase().includes(needle);
}

/** A scope's own totals (DR-10): its rows' count, money in, money out of non-fee rows, and charges. */
function scopeTotals(members: StatementRow[]): ScopeTotals {
  const totals = { count: members.length, inCents: 0, outCents: 0, chargeCents: 0 };
  for (const row of members) {
    totals.inCents += toCents(row.source.paid_in);
    if (row.isCharge) totals.chargeCents += toCents(row.source.paid_out);
    else totals.outCents += toCents(row.source.paid_out);
  }
  return totals;
}

/**
 * The banner's title and question for a scope: a named view's copy, a
 * bucket's, Spending channel's or charge cause's label, a receipt's number, or an entity's
 * name ("Not identified" for the engine's marker), from a "group" scope's
 * entity part too, with a question that follows the scope's measure.
 */
function scopeCopy(scope: LedgerScope) {
  if (scope.kind === "named") return NAMED_SCOPE_COPY[scope.value];
  if (scope.kind === "bucket") {
    const label = BUCKET_LABELS[scope.value as BucketId];
    return { title: label, question: bucketQuestion(label) };
  }
  if (scope.kind === "channel") {
    const label = CHANNEL_COPY[scope.value as SpendingChannel].label;
    return { title: label, question: channelQuestion(label) };
  }
  if (scope.kind === "cause") return { title: chargeCauseLabel(scope.value), question: chargeCauseQuestion(scope.value) };
  if (scope.kind === "receipt") return { title: `Receipt ${scope.value}`, question: ledger.receiptQuestion };
  const entity = scope.kind === "group" ? scope.value.slice(scope.value.indexOf(":") + 1) : scope.value;
  const name = entity === NO_ENTITY ? ledger.notIdentified : entity;
  const question =
    scope.measure === "both" ? `How much moved between me and ${name}?` : scope.measure === "in" ? `What came from ${name}?` : `What went to ${name}?`;
  return { title: name, question };
}

/** A cents amount without the currency, for the grid's numeric columns. */
function bare(cents: number) {
  return formatKes(cents / 100).replace("KES ", "");
}

/** The rows a set of lines stands for: each line's row and the charges shown on it. */
function rowsOfLines(lines: LedgerLine[]) {
  return lines.flatMap((line) => [line.row, ...line.foldedCharges]);
}

/** Links to the named views, each with its row count, the active one marked as the current page. */
function LedgerViews({ rows, active, request, importId, compact }: { rows: StatementRow[]; active: string | null; request: LedgerRequest; importId: number | null; compact: boolean }) {
  return (
    <nav aria-label="Ledger views" className="flex items-center gap-2 overflow-x-auto pb-0.5">
      {VIEWS.map((view) => {
        const count = view.id ? resolveLedgerScope(view.id, rows)?.rowIds.length ?? 0 : rows.length;
        const isActive = active === view.id;
        return (
          <Link
            key={view.label}
            href={ledgerHref({ scopeId: view.id, from: request.from, importId })}
            aria-current={isActive ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg transition-colors ${compact ? "px-3 py-1.5 text-xs font-headline" : "px-2.5 py-1 text-[11px] font-label"} ${
              isActive ? "bg-primary text-on-primary font-semibold" : "bg-surface-container-high text-on-surface-variant font-medium hover:bg-surface-container-highest"
            }`}
          >
            {view.label} ({count})
          </Link>
        );
      })}
    </nav>
  );
}

/** The header of the unscoped Ledger: what it is, and the import's own totals from its analytics. */
function AllRowsHeader({ summary, analytics, rowCount }: { summary: ImportSummary; analytics: AnalyticsResult; rowCount: number }) {
  const kpis = [
    { label: "Money in", value: `+${formatKes(analytics.cash_flow.total_inflow)}`, tone: "text-primary" },
    { label: "Money out", value: `-${formatKes(analytics.cash_flow.total_outflow)}`, tone: "text-on-surface", note: "incl. charges" },
    { label: "Charges", value: formatKes(analytics.fees.total_fees.total_fees), tone: "text-tertiary" },
    { label: "Closing balance", value: formatKes(analytics.cash_flow.closing_balance), tone: "text-on-surface" },
  ];
  return (
    <section className="flex flex-col gap-space-sm">
      <div className="flex flex-col gap-space-2xs">
        <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">
          Ledger • {formatPeriod(summary.period_start, summary.period_end)}
        </span>
        <h2 data-scope-title="" className="font-headline text-xl lg:text-2xl font-bold tracking-tight text-on-surface">
          {ledger.allTitle}
        </h2>
        <p className="font-body-sm text-body-sm text-on-surface-variant max-w-2xl">
          {rowCount} rows. {ledger.allDescription}
        </p>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-space-xs">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-surface-container-lowest rounded-xl p-space-sm border border-hairline shadow-sm flex flex-col gap-0.5 min-w-0">
            <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">{kpi.label}</span>
            <span className={`font-label-numeric-md text-label-numeric-md lg:text-lg font-bold tabular-nums ${kpi.tone}`}>{kpi.value}</span>
            {kpi.note && <span className="font-label text-[10px] text-on-surface-variant">{kpi.note}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The grid row of one line: receipt (opens the dialog), date, who, what it counts as, money in, money out, charge, balance. */
function GridRow({ line, cellPadding, onOpen }: { line: LedgerLine; cellPadding: string; onOpen: (line: LedgerLine, opener: HTMLElement) => void }) {
  const { row } = line;
  const inflow = row.direction === "in";
  const charge = row.isCharge ? row.principalCents : foldedChargeCents(line);
  return (
    <tr
      onClick={(event) => onOpen(line, event.currentTarget.querySelector("[data-receipt-opener]") as HTMLElement)}
      className={`cursor-pointer hover:bg-surface-container-low/60 transition-colors ${inflow ? "bg-primary-container/[0.02]" : ""}`}
    >
      <td className={`${cellPadding} px-4`}>
        <button
          type="button"
          data-receipt-opener=""
          data-line-key={row.id}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(line, event.currentTarget);
          }}
          className="receipt-badge hover:bg-primary hover:text-on-primary hover:border-primary"
        >
          {row.receiptNo}
        </button>
      </td>
      <td className={`${cellPadding} px-4 text-on-surface-variant font-label text-[11px] whitespace-nowrap tabular-nums`}>{formatDateTime(row.source.completion_time)}</td>
      <td className={`${cellPadding} px-4`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 rounded-xs flex items-center justify-center shrink-0 ${BUCKET_STYLE[row.bucket].tone}`}>
            <Icon name={BUCKET_STYLE[row.bucket].icon} size={15} />
          </div>
          <span className="font-body text-sm text-on-surface">{lineName(line)}</span>
        </div>
      </td>
      <td className={`${cellPadding} px-4`}>
        <CountsAsPill line={line} />
      </td>
      <td className={`${cellPadding} px-4 text-right font-label tabular-nums whitespace-nowrap ${inflow ? "font-bold text-primary" : "text-on-surface-variant/40"}`}>
        {inflow ? `+${bare(row.principalCents)}` : "—"}
      </td>
      <td className={`${cellPadding} px-4 text-right font-label tabular-nums whitespace-nowrap ${inflow || row.isCharge ? "text-on-surface-variant/40" : "font-semibold text-on-surface"}`}>
        {inflow || row.isCharge ? "—" : `-${bare(row.principalCents)}`}
      </td>
      <td className={`${cellPadding} px-4 text-right font-label tabular-nums ${charge > 0 ? "text-tertiary font-semibold" : "text-on-surface-variant/40"}`}>
        {charge > 0 ? bare(charge) : "—"}
      </td>
      <td className={`${cellPadding} px-4 text-right font-label font-bold text-on-surface tabular-nums whitespace-nowrap`}>{bare(toCents(row.source.balance))}</td>
    </tr>
  );
}

/** The controls of `container` that keyboard focus can reach, in tab order. */
function focusableIn(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')];
}

/**
 * Keep Tab inside an open modal dialog: from its last control Tab returns to
 * its first, and Shift+Tab from its first goes to its last. A native modal
 * dialog makes the page behind it inert, but Tab can still leave it for the
 * browser's own controls.
 */
function keepFocusInside(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = focusableIn(event.currentTarget);
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** A button revealing the next page of lines. */
function LoadMore({ hidden, onMore, className, children }: { hidden: boolean; onMore: () => void; className: string; children: ReactNode }) {
  if (hidden) return null;
  return (
    <button type="button" data-load-more="" onClick={onMore} className={className}>
      {children}
    </button>
  );
}

type LedgerContentProps = {
  transactions: Transaction[];
  summary: ImportSummary;
  analytics: AnalyticsResult;
  request: LedgerRequest;
};

/**
 * The Ledger over an import's loaded transactions: the scope's banner (or the
 * statement's header), its rows as lines, with search, views, density,
 * load-more and CSV export, and the receipt dialog. The scope, its rows, its
 * totals and every line come from the Stage 4b statement model.
 */
function LedgerContent({ transactions, summary, analytics, request }: LedgerContentProps) {
  const importId = summary.id;
  const rows = useMemo(() => transactions.map(toStatementRow), [transactions]);
  const links = useMemo(() => linkCharges(rows), [rows]);
  const scope = useMemo(() => (request.scopeId ? resolveLedgerScope(request.scopeId, rows) : null), [request.scopeId, rows]);
  const members = useMemo(() => {
    if (!scope) return rows;
    const ids = new Set(scope.rowIds);
    return rows.filter((row) => ids.has(row.id));
  }, [rows, scope]);
  const lines = useMemo(() => ledgerLines(members, links), [members, links]);

  const [query, setQuery] = useState("");
  const [dense, setDense] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<LedgerLine | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const needle = query.toLowerCase().trim();
  const searched = lines.filter((line) => matchesQuery(line, needle));
  const shown = searched.slice(0, limit);
  const inView = rowsOfLines(searched);
  const totals = scopeTotals(members);
  const isReceipt = scope?.kind === "receipt";
  const cellPadding = dense ? "py-1.5" : "py-3";
  const fileName = ledgerCsvFileName(summary);
  const status = `Showing ${shown.length} of ${searched.length} lines`;

  /** Open the receipt of `line`, remembering `opener` to give focus back when the dialog closes. */
  const open = (line: LedgerLine, opener: HTMLElement) => {
    openerRef.current = opener;
    setSelected(line);
    dialogRef.current?.showModal();
  };
  const showMore = () => setLimit((current) => current + PAGE);

  const header = scope ? (
    <ScopeBanner {...scopeCopy(scope)} totals={totals} figureCents={scopeFigureCents(rows, scope)} isReceipt={isReceipt} origin={request.from} importId={importId} />
  ) : (
    <AllRowsHeader summary={summary} analytics={analytics} rowCount={rows.length} />
  );

  const search = (id: string, className: string) => (
    <div className="relative flex-1">
      <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
      <input
        id={id}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={ledger.searchLabel}
        placeholder="Search receipt, name or statement text…"
        className={className}
      />
    </div>
  );

  return (
    <>
      <div data-ledger-ready="" className="flex flex-col gap-3 pt-3 pb-4 lg:pt-0">
        {request.unrecognised && (
          <p data-ledger-notice="" className="p-3 rounded-xl bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant">
            {ledger.unrecognised}
          </p>
        )}
        {header}
        {isReceipt && lines.length > 0 && (
          <section className="bg-surface-container-lowest rounded-xl border border-hairline shadow-sm p-space-base md:max-w-2xl">
            <ReceiptDetail line={lines[0]} origin={request.from} importId={importId} />
          </section>
        )}

        {/* Mobile and tablet: day-grouped cards. */}
        <div className="lg:hidden flex flex-col gap-3">
          <LedgerViews rows={rows} active={request.scopeId} request={request} importId={importId} compact />
          {search("ledger-search-mobile", "w-full h-11 pl-10 pr-3 rounded-xl bg-surface-container-lowest shadow-sm font-body text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-2 focus:outline-primary-container")}
          <p data-ledger-status="" className="px-1 font-label text-[11px] text-on-surface-variant">
            {status}
          </p>
          {groupByDay(shown).map((group) => (
            <section key={group.heading} className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1 pt-2">
                <span className="flex items-center gap-1.5 font-label text-[11px] uppercase tracking-wider text-on-surface-variant font-semibold">
                  <Icon name="calendar_today" size={14} />
                  {group.heading}
                </span>
                <span className="font-label text-[10px] uppercase text-on-surface-variant">
                  {group.lines.length} {group.lines.length === 1 ? "Entry" : "Entries"}
                </span>
              </div>
              {group.lines.map((line) => (
                <TxnRow key={line.row.id} line={line} time={lineTime(line)} onOpen={open} />
              ))}
            </section>
          ))}
          {searched.length === 0 && <p className="p-3 rounded-xl bg-surface-container-low font-body text-xs text-on-surface-variant">{members.length === 0 ? ledger.noRows : ledger.noMatches}</p>}
          <LoadMore
            hidden={searched.length <= limit}
            onMore={showMore}
            className="w-full min-h-11 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-body-sm text-body-sm font-semibold"
          >
            Show {Math.min(PAGE, searched.length - limit)} more of {searched.length}
          </LoadMore>
          <ExportLedgerButton
            rows={inView}
            fileName={fileName}
            className="w-full h-12 rounded-xl bg-primary text-on-primary font-headline text-sm font-semibold flex items-center justify-center gap-2 shadow-md"
          >
            <Icon name="download_for_offline" size={20} />
            Export these {inView.length} rows (CSV)
          </ExportLedgerButton>
        </div>

        {/* Desktop: the analytical grid. */}
        <div className="hidden lg:flex flex-col gap-4">
          <section className="bg-surface-container-lowest p-4 rounded-xs border border-hairline shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              {search("ledger-search-desktop", "w-full h-9 pl-9 pr-3 rounded-xs bg-surface-container-low text-xs text-on-surface placeholder:text-on-surface-variant/70 focus:outline-2 focus:outline-primary-container")}
              <div role="group" aria-label={ledger.densityLabel} className="flex items-center bg-surface-container-low p-0.5 rounded-xs text-xs">
                {[false, true].map((isDense) => (
                  <button
                    key={String(isDense)}
                    type="button"
                    aria-pressed={dense === isDense}
                    onClick={() => setDense(isDense)}
                    className={`px-2.5 py-1 rounded-xs font-medium text-[11px] ${dense === isDense ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
                  >
                    {isDense ? "Dense" : "Comfortable"}
                  </button>
                ))}
              </div>
              <ExportLedgerButton
                rows={inView}
                fileName={fileName}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xs bg-primary text-on-primary text-xs font-medium hover:bg-primary-container transition-colors shadow-sm whitespace-nowrap"
              >
                <Icon name="file_download" size={16} />
                Export {inView.length} rows
              </ExportLedgerButton>
            </div>
            <LedgerViews rows={rows} active={request.scopeId} request={request} importId={importId} compact={false} />
          </section>

          <section className="bg-surface-container-lowest rounded-xs border border-hairline shadow-sm overflow-hidden flex flex-col">
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[860px]">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant text-[11px] font-label uppercase tracking-wider">
                    <th className="py-3 px-4 font-semibold">Receipt</th>
                    <th className="py-3 px-4 font-semibold">Date &amp; time</th>
                    <th className="py-3 px-4 font-semibold min-w-[220px]">Who / what</th>
                    <th className="py-3 px-4 font-semibold">Counts as</th>
                    <th className="py-3 px-4 font-semibold text-right">Money in</th>
                    <th className="py-3 px-4 font-semibold text-right">Money out</th>
                    <th className="py-3 px-4 font-semibold text-right">Charge</th>
                    <th className="py-3 px-4 font-semibold text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low text-xs text-on-surface">
                  {shown.map((line) => (
                    <GridRow key={line.row.id} line={line} cellPadding={cellPadding} onOpen={open} />
                  ))}
                  {searched.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 px-4 text-center font-body text-xs text-on-surface-variant">
                        {members.length === 0 ? ledger.noRows : ledger.noMatches}
                      </td>
                    </tr>
                  )}
                </tbody>
                {scope && totals.count > 0 && !isReceipt && (
                  <tfoot>
                    <tr className="bg-surface-container-low font-label text-xs tabular-nums">
                      <td colSpan={4} className="py-3 px-4 font-semibold text-on-surface">
                        Total of all {totals.count} rows in this view
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-primary">{totals.inCents > 0 ? `+${bare(totals.inCents)}` : "—"}</td>
                      <td className="py-3 px-4 text-right font-bold text-on-surface">{totals.outCents > 0 ? `-${bare(totals.outCents)}` : "—"}</td>
                      <td className="py-3 px-4 text-right font-bold text-tertiary">{totals.chargeCents > 0 ? bare(totals.chargeCents) : "—"}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="px-4 py-3.5 bg-surface-container-low/60 flex items-center justify-between gap-3 text-xs">
              <span data-ledger-status="" className="font-body text-on-surface">
                {status} • {rows.length} rows on the statement
              </span>
              <LoadMore hidden={searched.length <= limit} onMore={showMore} className="font-label text-[11px] text-primary hover:underline">
                Show more
              </LoadMore>
            </div>
          </section>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="receipt-dialog-title"
        className={`${sheetDialogClasses} overflow-y-auto`}
        onClose={() => {
          setSelected(null);
          openerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        onKeyDown={keepFocusInside}
      >
        <div className="flex items-center justify-between mb-space-md">
          <h2 id="receipt-dialog-title" className="font-label-caps text-label-caps uppercase text-on-surface-variant">
            {ledger.dialogTitle} {selected?.row.receiptNo}
          </h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label={ledger.close}
            className="w-9 h-9 rounded-pill flex items-center justify-center hover:bg-surface-container text-on-surface-variant"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        {selected && <ReceiptDetail line={selected} origin={request.from} importId={importId} />}
      </dialog>
    </>
  );
}

/**
 * The Ledger's body inside an import that has loaded: its transactions from
 * the page's shared load (the Ledger page asks StatementDataProvider for
 * them). While they load, or when they fail, the import's period ribbon stays
 * above the loading state or the error card with Try again (T-LOADFAIL).
 */
function LedgerTransactions({ summary, analytics, request }: { summary: ImportSummary; analytics: AnalyticsResult; request: LedgerRequest }) {
  const shared = useSharedStatement();
  if (!shared?.transactions) throw new Error("LedgerExplorer needs a page that loads transactions");
  const state = shared.transactions;
  if (state.status === "ready") return <LedgerContent transactions={state.data} summary={summary} analytics={analytics} request={request} />;
  return (
    <>
      <PeriodRibbon range={formatPeriod(summary.period_start, summary.period_end)} badge={formatCount(summary.transaction_count, "transaction")} />
      {state.status === "loading" ? (
        <LoadingCard label="Loading transactions…" />
      ) : (
        <ErrorCard error={state.error} onRetry={shared.reloadTransactions} />
      )}
    </>
  );
}

/**
 * IA prototype: the evidence level. One scope of an import's rows at a time
 * (decision Q-R2: ?scope and the legacy parameters, ?from for the back link),
 * with what it is, where it came from and the total its own rows add up to;
 * every line opens its receipt. Loading, error and "no imports" states are
 * ImportScope's.
 */
export function LedgerExplorer({ request, importId }: { request: LedgerRequest; importId: number | null }) {
  return (
    <ImportScope importId={importId}>
      {({ summary, analytics }) => <LedgerTransactions summary={summary} analytics={analytics} request={request} />}
    </ImportScope>
  );
}
