import { hero } from "@/content/recovery";

export function RecoveryHero() {
  return (
    <div className="space-y-1.5 pt-1 text-center">
      <h1 className="font-headline text-[24px] leading-tight font-bold tracking-tight text-on-surface">
        {hero.title}
      </h1>
      <p className="font-body text-xs text-on-surface-variant leading-relaxed px-2">
        {hero.description}
      </p>
    </div>
  );
}
