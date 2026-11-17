// Stand-in for `next/navigation` (see loader-hooks.mjs). Every router call is
// recorded, never performed: tests assert the exact href the app hands to
// the router and resolve it themselves the way Next's client router does.

/** Router calls made since the last reset, as { method, href }. */
export const navigationCalls = [];

/** Forget recorded router calls between tests. */
export function resetNavigation() {
  navigationCalls.length = 0;
}

/** Return a router whose navigation methods only record their arguments. */
export function useRouter() {
  const record = (method) => (href) => {
    navigationCalls.push({ method, href });
  };
  return {
    push: record("push"),
    replace: record("replace"),
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  };
}

/** The pathname a client component would see on the login screen. */
export function usePathname() {
  return "/login";
}

/** Empty search params; the login page receives `next` as a server prop. */
export function useSearchParams() {
  return new URLSearchParams();
}

/** What Next's permanentRedirect throws to stop rendering; tests read its href. */
export class PermanentRedirect extends Error {
  constructor(href) {
    super(`permanent redirect to ${href}`);
    this.href = href;
  }
}

/** Record a permanent (308) redirect and stop rendering by throwing, as Next's permanentRedirect does. */
export function permanentRedirect(href) {
  navigationCalls.push({ method: "permanentRedirect", href });
  throw new PermanentRedirect(href);
}
