"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { merge as copy, settings } from "@/content/remember";
import type { MergeProposal } from "@/lib/api";
import { formatDate } from "@/lib/format";

type ProposalView = Pick<MergeProposal, "counts" | "differentAccount" | "newLedger" | "accountUnreadable" | "ledgerChoices">;

/**
 * The merge screen (CP9c items 3 and 4, N-26): the new, matched and collided counts before
 * anything is written, then save or don't save. A different account is offered as a separate
 * ledger, never a replace; an unreadable account is added only to a ledger the person picks.
 *
 * @param props.proposal The merge, from the data layer.
 * @param props.onConfirm Save it.
 * @param props.onCancel Don't save it.
 * @param props.onChoose For an unreadable account: add it to this saved ledger.
 * @param props.error A failure to show, or null.
 * @param props.busy True while saving.
 * @returns The screen's card.
 */
export function MergeReview({
  proposal,
  onConfirm,
  onCancel,
  onChoose,
  error = null,
  busy = false,
}: {
  proposal: ProposalView;
  onConfirm: () => void;
  onCancel: () => void;
  onChoose: (ledgerId: string) => void;
  error?: string | null;
  busy?: boolean;
}) {
  if (proposal.accountUnreadable) {
    return (
      <Card title={copy.unreadableTitle}>
        <p className="font-body text-xs text-on-surface-variant">{copy.unreadableBody}</p>
        <ul className="space-y-2">
          {proposal.ledgerChoices.map((ledger) => (
            <li key={ledger.ledgerId} className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-low p-3">
              <span className="font-body text-xs text-on-surface">
                {settings.ledgerLabel(formatDate(ledger.period.start), formatDate(ledger.period.end), ledger.statementCount)}
              </span>
              <button type="button" onClick={() => onChoose(ledger.ledgerId)} className={SECONDARY}>
                {copy.chooseLedgerLabel}
              </button>
            </li>
          ))}
        </ul>
        <Actions error={error}>
          <button type="button" onClick={onCancel} className={SECONDARY}>
            {copy.cancelLabel}
          </button>
        </Actions>
      </Card>
    );
  }
  const counts = proposal.counts ?? { new: 0, matched: 0, collided: 0 };
  return (
    <Card title={proposal.differentAccount ? copy.differentAccountTitle : copy.title}>
      {proposal.differentAccount && <p className="font-body text-xs text-on-surface">{copy.differentAccountBody}</p>}
      <p className="font-body text-xs text-on-surface-variant">{copy.description}</p>
      {proposal.newLedger && !proposal.differentAccount && <p className="font-body text-xs text-on-surface-variant">{copy.newLedgerNote}</p>}
      <dl className="grid grid-cols-3 gap-2" data-merge-counts="">
        <Count label={copy.newLabel} value={counts.new} name="new" />
        <Count label={copy.matchedLabel} value={counts.matched} name="matched" />
        <Count label={copy.collidedLabel} value={counts.collided} name="collided" />
      </dl>
      <p className="font-body text-[11px] text-on-surface-variant">{copy.collidedHelp}</p>
      <Actions error={error}>
        <button type="button" onClick={onConfirm} disabled={busy} className={PRIMARY} data-merge-confirm="">
          {proposal.differentAccount ? copy.confirmSeparateLabel : copy.confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY}>
          {copy.cancelLabel}
        </button>
      </Actions>
    </Card>
  );
}

/**
 * What the merge screen shows once the statement is saved: the counts and the collision count.
 *
 * @param props.counts What the merge did.
 * @param props.importId The saved statement's id, for its summary.
 * @returns The card.
 */
export function MergeSaved({ counts, importId }: { counts: { new: number; matched: number; collided: number }; importId: number }) {
  return (
    <Card title={copy.savedTitle}>
      <p className="font-body text-xs text-on-surface" data-merge-saved="">
        {copy.savedSummary(counts.new, counts.matched, counts.collided)}
      </p>
      <p className="font-body text-xs text-on-surface-variant" data-collision-count="">
        {copy.collisionCount(counts.collided)}
      </p>
      <Link href={`/analysis-summary?import=${importId}`} className={`${PRIMARY} self-start inline-flex items-center gap-1.5`}>
        {copy.viewAnalysis}
        <Icon name="arrow_forward" size={16} />
      </Link>
    </Card>
  );
}

const PRIMARY = "py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold";
const SECONDARY = "py-2 px-3 rounded-lg bg-surface-container text-on-surface font-headline text-xs font-medium";

/**
 * The merge screen's card frame.
 *
 * @param props.title The heading.
 * @param props.children The body.
 * @returns The card.
 */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface-container-lowest rounded-xl p-4 border border-hairline shadow-sm flex flex-col gap-3" data-merge="">
      <h1 className="font-headline text-base font-semibold text-on-surface">{title}</h1>
      {children}
    </section>
  );
}

/**
 * One count, labelled.
 *
 * @param props.label The label.
 * @param props.value The count.
 * @param props.name Its data attribute value, for tests.
 * @returns The count.
 */
function Count({ label, value, name }: { label: string; value: number; name: string }) {
  return (
    <div className="rounded-lg bg-surface-container-low p-3 flex flex-col gap-1">
      <dt className="font-label text-[11px] text-on-surface-variant">{label}</dt>
      <dd className="font-headline text-lg font-semibold text-on-surface tabular-nums" data-count={name}>
        {value}
      </dd>
    </div>
  );
}

/**
 * The buttons row, with any failure above it.
 *
 * @param props.error A failure to show, or null.
 * @param props.children The buttons.
 * @returns The row.
 */
function Actions({ error, children }: { error: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p className="font-body text-xs text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
