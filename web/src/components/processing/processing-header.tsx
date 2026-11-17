import Link from "next/link";
import { PrivateOnDevice } from "@/components/private-on-device";
import { Icon } from "@/components/icon";
import { pageCanvas } from "@/components/layout/canvas";
import { header } from "@/content/processing";

/**
 * Processing's own app bar: back to upload, the screen title and the account
 * control, with no tab bar, so a tap cannot leave the screen mid-analysis by
 * accident. It is the only header at every width (PageShell gets no desktop
 * bar for this screen); from tablet up it sits on the shared page canvas.
 */
export function ProcessingHeader() {
  return (
    <header className="fixed top-0 w-full z-50 pt-safe bg-surface/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className={`h-16 flex items-center justify-between ${pageCanvas}`}>
        <div className="flex items-center gap-2">
          <Link
            href="/upload"
            aria-label={header.backLabel}
            className="w-11 h-11 flex items-center justify-center text-on-surface rounded-lg hover:bg-surface-container transition-colors"
          >
            <Icon name="arrow_back" size={20} />
          </Link>
          <div className="flex flex-col">
            <span className="font-headline font-semibold text-sm tracking-tight text-on-surface">
              {header.title}
            </span>
            <div className="flex items-center gap-1">
              <Icon name="lock" size={12} className="text-primary" />
              <span className="text-[10px] font-label text-on-surface-variant uppercase tracking-wider">
                {header.tag}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PrivateOnDevice />
        </div>
      </div>
    </header>
  );
}
