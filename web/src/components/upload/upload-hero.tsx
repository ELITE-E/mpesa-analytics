import { hero } from "@/content/upload";

export function UploadHero() {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-on-surface-variant">
        <span className="w-1.5 h-1.5 rounded-pill bg-primary animate-pulse" />
        <span className="font-label text-[10px] tracking-widest uppercase font-semibold text-primary">
          {hero.stepLabel}
        </span>
      </div>
      <h1 className="font-headline text-2xl font-bold tracking-tight text-on-surface">
        {hero.title}
      </h1>
      <p className="font-body text-xs leading-relaxed text-on-surface-variant">
        {hero.description}
      </p>
    </div>
  );
}
