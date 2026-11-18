"use client";

import { useState } from "react";
import { deleteAll as copy } from "@/content/remember";
import { deleteEverything } from "@/lib/remember";

/**
 * Delete all saved data, after a confirmation step (CP9c items 2 and 5, N-15, N-16). Works while
 * locked, for a forgotten passphrase.
 *
 * @param props.label The first button's words ("Delete all saved data", or the forgot path's).
 * @param props.onDeleted Called once everything is deleted.
 * @returns The control.
 */
export function DeleteAllControl({ label, onDeleted }: { label: string; onDeleted?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);

  /** Delete everything, then say so. */
  async function confirm() {
    await deleteEverything();
    setConfirming(false);
    setDeleted(true);
    onDeleted?.();
  }

  if (deleted) {
    return (
      <p className="font-body text-xs text-on-surface" role="status">
        {copy.done}
      </p>
    );
  }
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="self-start py-2 px-3 rounded-lg bg-surface-container text-error font-headline text-xs font-semibold"
      >
        {label}
      </button>
    );
  }
  return (
    <div className="rounded-lg bg-surface-container-low p-3 space-y-2" role="alertdialog" aria-label={copy.title}>
      <p className="font-body text-xs text-on-surface">{copy.confirmQuestion}</p>
      <div className="flex gap-2">
        <button type="button" onClick={confirm} className="py-2 px-3 rounded-lg bg-error text-on-error font-headline text-xs font-semibold">
          {copy.confirmAction}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="py-2 px-3 rounded-lg bg-surface-container text-on-surface font-headline text-xs font-medium"
        >
          {copy.keepAction}
        </button>
      </div>
    </div>
  );
}
