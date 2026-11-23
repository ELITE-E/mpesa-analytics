// Registers the app's service worker (public/sw.js, CP10a item 4) and offers its updates. An update
// takes over only after the person accepts: the waiting worker is told to skip waiting, and the
// page reloads once it has taken over.

type WaitingWorker = { postMessage(message: unknown): void };
type Registration = {
  waiting?: WaitingWorker | null;
  installing?: (WaitingWorker & { state?: string; addEventListener(type: string, listener: () => void): void }) | null;
  addEventListener(type: string, listener: () => void): void;
};
type Container = {
  controller: unknown;
  register(url: string, options: { scope: string }): Promise<Registration>;
  addEventListener(type: string, listener: () => void): void;
};

/**
 * Register the service worker, and offer each waiting update.
 *
 * @param scope Where to find `serviceWorker` (the browser's navigator; tests pass their own).
 * @param handlers `onUpdate(accept)`: show the prompt; calling `accept` makes the update take over.
 *   `reload`: reload the page once the update has taken over.
 * @returns Resolves once registered, or at once without service worker support.
 */
export async function registerServiceWorker(
  scope: { serviceWorker?: Container },
  handlers: { onUpdate: (accept: () => void) => void; reload: () => void },
): Promise<void> {
  const container = scope.serviceWorker;
  if (!container) return;
  let accepted = false;
  container.addEventListener("controllerchange", () => {
    if (accepted) handlers.reload();
  });
  const registration = await container.register("/sw.js", { scope: "/" });
  const offer = (worker: WaitingWorker) =>
    handlers.onUpdate(() => {
      accepted = true;
      worker.postMessage({ type: "SKIP_WAITING" });
    });
  // A first install has no controller yet: it simply takes over; only a replacement is offered.
  if (registration.waiting && container.controller) offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    installing?.addEventListener("statechange", () => {
      if (installing.state === "installed" && container.controller) offer(installing);
    });
  });
}
