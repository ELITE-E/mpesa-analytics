"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { UnlockForm } from "@/components/remember/unlock-form";
import { settings } from "@/content/remember";
import { rememberView, subscribeRemember } from "@/lib/remember";

/**
 * The unlock screen, following the controller: the form while locked, else a link to settings.
 *
 * @returns The panel.
 */
export function UnlockPanel() {
  const view = useSyncExternalStore(subscribeRemember, rememberView, rememberView);
  if (view.phase === "locked") return <UnlockForm view={view} />;
  if (view.phase === "starting") return null;
  return (
    <Link href="/settings" className="self-start py-2 px-3 rounded-lg bg-surface-container text-on-surface font-headline text-xs font-medium">
      {settings.settingsLink}
    </Link>
  );
}
