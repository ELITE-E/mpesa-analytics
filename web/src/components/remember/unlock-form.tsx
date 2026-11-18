"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/icon";
import { DeleteAllControl } from "@/components/remember/delete-all";
import { unlock as copy } from "@/content/remember";
import { listImports } from "@/lib/api";
import { unlockRemember, type RememberView } from "@/lib/remember";

const NOTICES = { idle: copy.idleNotice, manual: copy.lockedNotice, elsewhere: copy.elsewhereNotice } as const;

/**
 * The unlock screen (CP9c item 2): the passphrase, the hint only after a failed attempt, why it
 * locked, and the "forgot it?" path: delete the saved data and read the PDFs again.
 *
 * @param props.view What the controller says about this device.
 * @returns The form.
 */
export function UnlockForm({ view }: { view: Pick<RememberView, "phase" | "hint" | "lockReason"> }) {
  const router = useRouter();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  /**
   * Unlock, then open the latest saved statement's summary.
   *
   * @param event The submit event.
   */
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await unlockRemember(passphrase);
    } catch (refusal) {
      setPassphrase("");
      setError(refusal instanceof Error ? refusal.message : copy.wrongPassphrase);
      return;
    }
    const latest = (await listImports(1)).items[0];
    router.replace(latest ? `/analysis-summary?import=${latest.id}` : "/upload");
  }

  const notice = view.lockReason ? NOTICES[view.lockReason as keyof typeof NOTICES] : null;
  return (
    <section className="bg-surface-container-lowest rounded-xl p-4 border border-hairline shadow-sm space-y-4" data-unlock="">
      <div className="flex items-center gap-2">
        <Icon name="lock" size={18} className="text-primary" />
        <h1 className="font-headline text-base font-semibold text-on-surface">{copy.title}</h1>
      </div>
      {notice && (
        <p className="rounded-lg bg-surface-container-low p-3 font-body text-xs text-on-surface" role="status" data-lock-notice="">
          {notice}
        </p>
      )}
      <p className="font-body text-xs text-on-surface-variant">{copy.description}</p>
      <form onSubmit={submit} className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="font-label text-xs font-medium text-on-surface">{copy.passphraseLabel}</span>
          <input
            type="password"
            name="passphrase"
            autoComplete="current-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm"
          />
        </label>
        {error && (
          <p className="font-body text-xs text-error" role="alert">
            {error}
          </p>
        )}
        {view.hint && (
          <p className="font-body text-xs text-on-surface-variant" data-hint="">
            {copy.hintLabel}: <span className="text-on-surface">{view.hint}</span>
          </p>
        )}
        <button type="submit" className="py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold">
          {copy.submitLabel}
        </button>
      </form>
      <div className="border-t border-hairline pt-3 space-y-2">
        <p className="font-headline text-xs font-semibold text-on-surface">{copy.forgotTitle}</p>
        <p className="font-body text-xs text-on-surface-variant">{copy.forgotBody}</p>
        <DeleteAllControl label={copy.forgotAction} onDeleted={() => router.replace("/upload")} />
      </div>
    </section>
  );
}
