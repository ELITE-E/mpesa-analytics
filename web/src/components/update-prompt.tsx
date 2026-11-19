"use client";

import { useEffect, useState } from "react";
import { updatePrompt as copy } from "@/content/pwa";
import { registerServiceWorker } from "@/lib/service-worker";

/**
 * The update prompt (CP10a item 4): a new version is ready; reload to update, or later.
 *
 * @param props.onAccept Take the update and reload.
 * @param props.onLater Keep this version for now.
 * @returns The prompt.
 */
export function UpdatePrompt({ onAccept, onLater }: { onAccept: () => void; onLater: () => void }) {
  return (
    <div role="status" className="fixed bottom-24 left-4 right-4 z-50 mx-auto max-w-md rounded-xl bg-inverse-surface p-3 shadow-lg flex items-center gap-3" data-update-prompt="">
      <p className="flex-1 font-body text-xs text-inverse-on-surface">{copy.message}</p>
      <button type="button" onClick={onAccept} className="py-1.5 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold">
        {copy.acceptLabel}
      </button>
      <button type="button" onClick={onLater} className="py-1.5 px-3 rounded-lg text-inverse-on-surface font-headline text-xs font-medium">
        {copy.laterLabel}
      </button>
    </div>
  );
}

/**
 * Registers the service worker once the page is in the browser, and shows the update prompt
 * when a new version waits.
 *
 * @returns The prompt while an update waits, else nothing.
 */
export function ServiceWorkerSetup() {
  const [accept, setAccept] = useState<(() => void) | null>(null);
  useEffect(() => {
    void registerServiceWorker(navigator as unknown as Parameters<typeof registerServiceWorker>[0], {
      onUpdate: (acceptUpdate) => setAccept(() => acceptUpdate),
      reload: () => window.location.reload(),
    }).catch(() => undefined);
  }, []);
  if (accept === null) return null;
  return <UpdatePrompt onAccept={accept} onLater={() => setAccept(null)} />;
}
