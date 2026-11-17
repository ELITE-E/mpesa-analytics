import Link from "next/link";
import { Icon } from "@/components/icon";
import { uploadCallToAction } from "@/content/welcome";

export function UploadCallToAction() {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <Link
        href="/upload"
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-primary text-on-primary font-headline text-sm font-semibold tracking-wide shadow-sm hover:bg-primary-container transition-all"
      >
        <Icon name="cloud_upload" size={20} />
        <span>{uploadCallToAction.label}</span>
        <Icon name="arrow_forward" size={18} />
      </Link>
      <p className="flex items-center gap-1.5 font-label text-[11px] text-on-surface-variant">
        <Icon name="lock" size={14} className="text-primary" />
        <span>{uploadCallToAction.reassurance}</span>
      </p>
    </div>
  );
}
