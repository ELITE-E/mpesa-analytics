import { hero } from "@/content/welcome";

export function WelcomeHero() {
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-pill bg-surface-container-low border border-hairline shadow-sm">
        <span className="w-2 h-2 rounded-pill bg-primary animate-pulse" />
        <span className="font-label text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase">
          {hero.engineLabel}
        </span>
        <span className="text-outline-variant font-label text-[10px]">•</span>
        <span className="font-label text-[10px] text-primary font-medium">
          {hero.privacyLabel}
        </span>
      </div>
      <h1 className="font-headline text-2xl sm:text-3xl font-bold tracking-tight text-on-surface leading-tight mt-1">
        {hero.headline}
      </h1>
      <p className="font-body text-sm sm:text-base text-on-surface-variant leading-relaxed">
        {hero.description}
      </p>
    </div>
  );
}
