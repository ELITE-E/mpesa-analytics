import Link from "next/link";
import { Icon } from "@/components/icon";
import { statusBar } from "@/content/recovery";

export function RecoveryStatusBar() {
  return (
    <div className="flex items-center justify-between">
      <Link
        href="/upload"
        aria-label={statusBar.dismissLabel}
        className="w-8 h-8 rounded-pill bg-surface-container flex items-center justify-center text-on-surface-variant active:scale-95 transition-transform"
      >
        <Icon name="close" size={18} />
      </Link>
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-surface-container-high text-on-surface-variant font-label text-[10px] tracking-wide uppercase font-semibold">
        <span className="w-1.5 h-1.5 rounded-pill bg-tertiary" />
        <span>{statusBar.label}</span>
      </div>
      <div
        className="w-8 h-8 rounded-pill bg-surface-container flex items-center justify-center text-on-surface-variant"
        title={statusBar.lockTitle}
      >
        <Icon name="lock" size={17} />
      </div>
    </div>
  );
}
