import Link from "next/link";
import { Icon } from "@/components/icon";
import type { ApiError } from "@/lib/api";

const CARD = "bg-surface-container-lowest rounded-xl p-5 border border-hairline shadow-sm flex flex-col gap-3";

export function LoadingCard({ label = "Loading your statement…" }: { label?: string }) {
  return (
    <div className={CARD} role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-on-surface-variant">
        <Icon name="progress_activity" size={18} className="animate-spin text-primary" />
        <span className="font-body text-xs">{label}</span>
      </div>
      <div className="h-3 rounded-pill bg-surface-container animate-pulse" />
      <div className="h-3 w-2/3 rounded-pill bg-surface-container animate-pulse" />
    </div>
  );
}

export function ErrorCard({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className={CARD} role="alert">
      <div className="flex items-center gap-2">
        <Icon name="error" size={18} className="text-error" />
        <span className="font-headline text-sm font-semibold text-on-surface">
          {error.status === 404 ? "Not found" : "Could not load this data"}
        </span>
      </div>
      <p className="font-body text-xs text-on-surface-variant leading-relaxed">{error.message}</p>
      <div className="flex gap-2">
        {onRetry && error.status !== 404 && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold"
          >
            <Icon name="refresh" size={16} />
            Try again
          </button>
        )}
        <Link
          href="/upload"
          className="inline-flex items-center gap-1.5 py-2 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-headline text-xs font-medium"
        >
          Upload a statement
        </Link>
      </div>
    </div>
  );
}

export function NoImportsCard() {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <Icon name="upload_file" size={18} className="text-primary" />
        <span className="font-headline text-sm font-semibold text-on-surface">
          No statements yet
        </span>
      </div>
      <p className="font-body text-xs text-on-surface-variant leading-relaxed">
        Upload an M-PESA statement to see your analysis here.
      </p>
      <Link
        href="/upload"
        className="self-start inline-flex items-center gap-1.5 py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold"
      >
        Upload a statement
        <Icon name="arrow_forward" size={16} />
      </Link>
    </div>
  );
}

export function EmptySection({ message }: { message: string }) {
  return <p className="font-body text-xs text-on-surface-variant italic">{message}</p>;
}
