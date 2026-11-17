import { Icon } from "@/components/icon";
import { ussd } from "@/content/recovery";

export function UssdGuidanceCard() {
  return (
    <div className="rounded-xl bg-surface-container p-3.5 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface-variant flex-shrink-0">
        <Icon name="dialpad" size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-body text-[11px] text-on-surface-variant leading-snug">
          {ussd.before}{" "}
          <span className="font-label font-semibold text-on-surface bg-surface-container-highest px-1.5 py-0.5 rounded-xs text-[11px]">
            {ussd.code}
          </span>{" "}
          {ussd.after}
        </p>
      </div>
      <a
        href={ussd.href}
        className="px-2.5 py-1.5 rounded-lg bg-surface-container-highest text-primary font-headline text-[11px] font-semibold hover:bg-surface-variant transition-colors flex-shrink-0"
      >
        {ussd.dialLabel}
      </a>
    </div>
  );
}
