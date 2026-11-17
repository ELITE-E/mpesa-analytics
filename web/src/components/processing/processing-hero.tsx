import { hero } from "@/content/processing";

export function ProcessingHero() {
  return (
    <div className="px-4 pt-4 pb-2">
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-container rounded-pill mb-3">
        <span className="w-1.5 h-1.5 rounded-pill bg-primary-container animate-pulse" />
        <span className="font-label text-[10px] font-semibold text-primary uppercase tracking-widest">
          {hero.stepLabel}
        </span>
      </div>
      <h1 className="font-headline text-2xl font-bold text-on-surface tracking-tight">
        {hero.title}
      </h1>
      <p className="font-body text-xs text-on-surface-variant mt-1.5 leading-relaxed">
        {hero.description}
      </p>
    </div>
  );
}
