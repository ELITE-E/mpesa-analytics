import { hero } from "@/content/analysis-summary";

/** `verificationCode` is known only in the tab that uploaded the statement. */
export function SummaryHero({
  description,
  verificationCode,
}: {
  description: string;
  verificationCode: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-surface-container-high text-[10px] font-label font-semibold text-primary uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-pill bg-primary animate-pulse" />
          {hero.statusLabel}
        </span>
        {verificationCode && (
          <span className="text-xs font-label text-on-surface-variant/70">
            {hero.verificationLabel}: {verificationCode}
          </span>
        )}
      </div>
      <div className="flex flex-col">
        <h1 className="text-2xl sm:text-3xl font-headline font-bold text-on-surface tracking-tight">
          {hero.title}
        </h1>
        <p className="text-sm font-body text-on-surface-variant mt-1 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
