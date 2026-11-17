import Link from "next/link";

/**
 * The page for an address the app does not have (CP8b). Next's built-in one sets inline styles,
 * which the app's CSP (style-src 'self') blocks, so this one uses the app's own classes.
 *
 * @returns The page.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-surface">
      <div className="max-w-md w-full bg-surface-container-lowest rounded-xl p-5 border border-hairline shadow-sm flex flex-col gap-3">
        <h1 className="font-headline text-lg font-bold text-on-surface">Page not found</h1>
        <p className="font-body text-sm text-on-surface-variant">There is no page at this address.</p>
        <Link
          href="/"
          className="self-start inline-flex items-center gap-1.5 py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold"
        >
          Go to the start
        </Link>
      </div>
    </main>
  );
}
