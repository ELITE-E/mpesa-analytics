"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "@/components/icon";
import { claims, rememberCard as copy, type ClaimId } from "@/content/remember";
import { turnOnRemember, type RememberView } from "@/lib/remember";

/**
 * The "Remember on this device" card (CP9c item 1): off by default; says in plain words what the
 * lock protects and what it does not (docs/THREAT_MODEL.md); turning it on asks for the
 * passphrase twice and an optional hint, which it warns is stored unencrypted.
 *
 * @param props.view What the controller says about this device.
 * @returns The card.
 */
export function RememberCard({ view }: { view: Pick<RememberView, "phase"> & Partial<RememberView> }) {
  const [settingUp, setSettingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Turn remembering on with what the form holds; show the refusal if there is one.
   *
   * @param request The passphrase, its confirmation and the hint.
   */
  async function submit(request: { passphrase: string; confirmation: string; hint: string }) {
    setError(null);
    try {
      await turnOnRemember(request);
      setSettingUp(false);
    } catch (refusal) {
      setError(refusal instanceof Error ? refusal.message : copy.passphrasesDiffer);
    }
  }

  const badge = view.phase === "unlocked" ? copy.onBadge : view.phase === "locked" ? copy.lockedBadge : copy.offBadge;
  return (
    <section className="bg-surface-container-lowest rounded-xl p-4 border border-hairline shadow-sm space-y-4" data-remember-card="">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="lock" size={18} className="text-primary" />
          <h2 className="font-headline text-sm font-semibold text-on-surface">{copy.title}</h2>
        </div>
        <span className="font-label text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-surface-container text-on-surface-variant" data-remember-state="">
          {badge}
        </span>
      </div>
      <p className="font-body text-xs text-on-surface-variant">{copy.intro}</p>
      <ClaimList title={copy.protectsTitle} ids={copy.protects} icon="verified_user" />
      <ClaimList title={copy.limitsTitle} ids={copy.limits} icon="info" />
      {view.phase === "unavailable" && (
        <div className="rounded-lg bg-surface-container-low p-3 space-y-1" role="status">
          <p className="font-headline text-xs font-semibold text-on-surface">{copy.unavailableTitle}</p>
          <p className="font-body text-xs text-on-surface-variant">{view.storageMessage}</p>
        </div>
      )}
      {view.phase === "unlocked" && <p className="font-body text-xs text-on-surface" role="status">{copy.turnedOn}</p>}
      {view.phase === "off" && !settingUp && (
        <button
          type="button"
          onClick={() => setSettingUp(true)}
          data-remember-turn-on=""
          className="inline-flex items-center gap-1.5 py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold"
        >
          {copy.turnOnLabel}
        </button>
      )}
      {view.phase === "off" && settingUp && (
        <RememberSetupForm onSubmit={submit} onCancel={() => setSettingUp(false)} error={error} />
      )}
    </section>
  );
}

/**
 * The form that turns remembering on: the passphrase twice, then the optional hint with its
 * warning that it is stored unencrypted.
 *
 * @param props.onSubmit Called with the passphrase, its confirmation and the hint.
 * @param props.onCancel Called when the person decides not to.
 * @param props.error A refusal to show, or null.
 * @returns The form.
 */
export function RememberSetupForm({
  onSubmit,
  onCancel,
  error,
}: {
  onSubmit: (request: { passphrase: string; confirmation: string; hint: string }) => void;
  onCancel: () => void;
  error: string | null;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [hint, setHint] = useState("");

  /**
   * Hand the form's values over; the page does not navigate.
   *
   * @param event The submit event.
   */
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ passphrase, confirmation, hint });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-remember-setup="">
      <Field label={copy.passphraseLabel} help={copy.passphraseHelp}>
        <input
          type="password"
          name="passphrase"
          autoComplete="new-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm"
        />
      </Field>
      <Field label={copy.confirmLabel}>
        <input
          type="password"
          name="confirmation"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm"
        />
      </Field>
      <Field label={copy.hintLabel} help={`${copy.hintWarning} ${copy.hintRule}`}>
        <input
          type="text"
          name="hint"
          maxLength={60}
          autoComplete="off"
          value={hint}
          onChange={(event) => setHint(event.target.value)}
          className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm"
        />
      </Field>
      {error && (
        <p className="font-body text-xs text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold" data-remember-submit="">
          {copy.submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="py-2 px-3 rounded-lg bg-surface-container text-on-surface font-headline text-xs font-medium">
          {copy.cancelLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * A labelled field with optional help text.
 *
 * @param props.label The label.
 * @param props.help Help shown under the label.
 * @param props.children The input.
 * @returns The field.
 */
function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-label text-xs font-medium text-on-surface">{label}</span>
      {help && <span className="font-body text-[11px] text-on-surface-variant">{help}</span>}
      {children}
    </label>
  );
}

/**
 * A titled list of claims.
 *
 * @param props.title The list's title.
 * @param props.ids The claims, by id.
 * @param props.icon The icon beside each.
 * @returns The list.
 */
function ClaimList({ title, ids, icon }: { title: string; ids: ClaimId[]; icon: string }) {
  return (
    <div className="space-y-1.5">
      <p className="font-headline text-xs font-semibold text-on-surface">{title}</p>
      <ul className="space-y-1">
        {ids.map((id) => (
          <li key={id} className="flex items-start gap-2 font-body text-xs text-on-surface-variant" data-claim={id}>
            <Icon name={icon} size={14} className="text-primary mt-0.5 shrink-0" />
            <span>{claims[id]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
