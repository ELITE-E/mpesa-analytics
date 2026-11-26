import { PrivateOnDevice } from "@/components/private-on-device";
import { RememberHeaderControls } from "@/components/remember/lock-control";
import { Icon } from "@/components/icon";
import { BrandMark } from "@/components/brand-mark";
import { APP_NAME } from "@/content/brand";

/**
 * Fixed mobile and tablet header of the ingest screens: the app's mark and
 * name (content/brand.ts), a privacy line limited to what the API guarantees (imports are
 * owner-scoped), and the account control. It is `display: none` from 1024px,
 * where PageShell shows the desktop app bar instead.
 */
export function AppHeader() {
  return (
    <header className="lg:hidden fixed top-0 w-full z-50 pt-safe bg-surface/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="h-16 px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center">
            <BrandMark size={20} />
          </div>
          <div className="flex flex-col">
            <span className="font-headline font-semibold text-xs tracking-tight text-on-surface">
              {APP_NAME}
            </span>
            <span className="text-[11px] font-body text-on-surface-variant flex items-center gap-1">
              <Icon name="verified_user" size={12} className="text-primary" />
              Read in this browser
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PrivateOnDevice />
          <RememberHeaderControls />
        </div>
      </div>
    </header>
  );
}
