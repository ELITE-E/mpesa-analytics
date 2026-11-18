"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";
import { settings, unlock as copy } from "@/content/remember";
import { lockRemember, rememberView, subscribeRemember, type RememberView } from "@/lib/remember";

/**
 * The header's remember control (CP9c item 2): a Lock button while unlocked, a link to the unlock
 * screen while locked, nothing while remembering is off or unavailable.
 *
 * @param props.view What the controller says about this device.
 * @returns The control, or nothing.
 */
export function LockControl({ view }: { view: Pick<RememberView, "phase"> }) {
  if (view.phase === "unlocked") {
    return (
      <button
        type="button"
        onClick={lockRemember}
        className="inline-flex items-center gap-1 rounded-pill bg-surface-container px-2 py-1 text-xs font-medium text-on-surface"
        data-lock-button=""
      >
        <Icon name="lock" size={14} />
        {copy.lockLabel}
      </button>
    );
  }
  if (view.phase === "locked") {
    return (
      <Link
        href="/unlock"
        className="inline-flex items-center gap-1 rounded-pill bg-surface-container px-2 py-1 text-xs font-medium text-on-surface"
        data-unlock-link=""
      >
        <Icon name="lock" size={14} />
        {copy.lockedChip} · {copy.unlockChip}
      </Link>
    );
  }
  return null;
}

/**
 * The header's remember control, following the controller.
 *
 * @returns The control.
 */
export function HeaderLockControl() {
  const view = useSyncExternalStore(subscribeRemember, rememberView, rememberView);
  return <LockControl view={view} />;
}

/**
 * The header's remember controls: a link to the saved-data settings, and Lock or Unlock.
 *
 * @returns The controls.
 */
export function RememberHeaderControls() {
  return (
    <>
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 rounded-pill bg-surface-container px-2 py-1 text-xs font-medium text-on-surface-variant"
        data-settings-link=""
      >
        <Icon name="settings" size={14} />
        {settings.settingsLink}
      </Link>
      <HeaderLockControl />
    </>
  );
}
