"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { MergeReview, MergeSaved } from "@/components/remember/merge-review";
import { merge as copy } from "@/content/remember";
import { ApiError, type MergeProposal } from "@/lib/api";
import { clearPendingMerge, pendingMerge } from "@/lib/upload-flow";

/** Nothing to subscribe to: the waiting merge is set before this screen opens. */
function subscribeToNothing() {
  return () => {};
}

type Outcome =
  | { kind: "reviewing"; proposal: MergeProposal }
  | { kind: "saved"; counts: { new: number; matched: number; collided: number }; importId: number }
  | { kind: "cancelled" };

/**
 * The merge screen, holding the waiting merge: review, then saved or cancelled.
 *
 * @returns The panel.
 */
export function MergePanel() {
  const waiting = useSyncExternalStore(subscribeToNothing, pendingMerge, () => null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = outcome ?? (waiting ? { kind: "reviewing" as const, proposal: waiting } : null);

  if (current === null) return <Missing />;
  if (current.kind === "saved") return <MergeSaved counts={current.counts} importId={current.importId} />;
  if (current.kind === "cancelled") {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-body text-sm text-on-surface" role="status">
          {copy.cancelled}
        </p>
        <Link href="/upload" className="self-start py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold">
          {copy.missingAction}
        </Link>
      </div>
    );
  }
  const { proposal } = current;

  /** Save the statement: the one write. */
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const saved = await proposal.confirm();
      clearPendingMerge();
      setOutcome({ kind: "saved", counts: saved.counts, importId: saved.created.import.id });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : copy.cancelled);
    } finally {
      setBusy(false);
    }
  }

  /** Don't save it: nothing is written. */
  function cancel() {
    proposal.cancel();
    clearPendingMerge();
    setOutcome({ kind: "cancelled" });
  }

  /**
   * For an unreadable account: work out the merge into the picked ledger.
   *
   * @param ledgerId The picked ledger.
   */
  async function choose(ledgerId: string) {
    setOutcome({ kind: "reviewing", proposal: await proposal.chooseLedger(ledgerId) });
  }

  return <MergeReview proposal={proposal} onConfirm={confirm} onCancel={cancel} onChoose={choose} error={error} busy={busy} />;
}

/**
 * What the merge screen says when no statement is waiting.
 *
 * @returns The message.
 */
function Missing() {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-sm text-on-surface-variant">{copy.missing}</p>
      <Link href="/upload" className="self-start py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold">
        {copy.missingAction}
      </Link>
    </div>
  );
}
