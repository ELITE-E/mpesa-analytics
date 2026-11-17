import { PrivateOnDevice } from "@/components/private-on-device";
import { Icon } from "@/components/icon";

/**
 * Fixed mobile and tablet header of the ingest screens: product name, brand
 * badge, a privacy line limited to what the API guarantees (imports are
 * owner-scoped), and the account control. It is `display: none` from 1024px,
 * where PageShell shows the desktop app bar instead.
 */
export function AppHeader() {
  return (
    <header className="lg:hidden fixed top-0 w-full z-50 pt-safe bg-surface/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="h-16 px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center">
            <Icon name="account_balance" size={20} />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-headline font-semibold text-xs tracking-tight text-on-surface">
                M-Pesa Analytics
              </span>
              <span className="px-1.5 py-0.5 rounded-pill bg-surface-container-high text-[10px] font-label font-medium text-on-surface-variant flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-pill bg-primary" />
                Sovereign Ledger
              </span>
            </div>
            <span className="text-[11px] font-body text-on-surface-variant flex items-center gap-1">
              <Icon name="verified_user" size={12} className="text-primary" />
              Read in this browser
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PrivateOnDevice />
        </div>
      </div>
    </header>
  );
}
