import { canvasFrame } from "@/components/layout/canvas";

/**
 * Desktop-only (≥1024px) footer with the IA prototype's Stitch layout. Its
 * wording is limited to supported facts (migration decisions C-13 and Q-C2):
 * the brand, what the app does, that imports are private to the account
 * (owner-scoped by the API), that the app is not affiliated with Safaricom (CP10b), and the year
 * it is rendered in. The prototype's
 * "Institutional engine", reconciliation, hash and encryption labels and its
 * fixed year were not carried over. Pages render per request, so the year is
 * always current.
 */
export function DesktopFooter() {
  return (
    <footer className="hidden lg:block w-full bg-surface-container-lowest border-t border-surface-container-high py-8">
      <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 ${canvasFrame}`}>
        <div className="flex items-center gap-4 text-xs font-label text-on-surface-variant whitespace-nowrap">
          <span>SOVEREIGN LEDGER</span>
          <span>•</span>
          <span>M-PESA STATEMENT ANALYSIS</span>
        </div>
        <div className="flex items-center gap-6 text-xs text-on-surface-variant font-label whitespace-nowrap">
          <span>PRIVATE ON THIS DEVICE</span>
          <span>NOT AFFILIATED WITH SAFARICOM</span>
          <span>
            © {new Date().getFullYear()} Sovereign Ledger
          </span>
        </div>
      </div>
    </footer>
  );
}
