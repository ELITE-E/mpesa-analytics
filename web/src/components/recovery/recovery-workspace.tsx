"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";
import { UssdGuidanceCard } from "@/components/recovery/ussd-guidance-card";
import { failureCard, remedies } from "@/content/recovery";
import {
  hasPendingUpload,
  lastUploadFailure,
  pendingFileName,
} from "@/lib/upload-flow";

function subscribeToNothing() {
  return () => {};
}

// Shows why the last upload in this tab failed, as reported by the API, and
// offers a retry only when the same file could succeed unchanged (network,
// busy or storage failures); otherwise the user chooses another statement.
export function RecoveryWorkspace() {
  const router = useRouter();
  const failure = useSyncExternalStore(subscribeToNothing, lastUploadFailure, () => null);
  const canRetry = useSyncExternalStore(
    subscribeToNothing,
    () => hasPendingUpload() && (lastUploadFailure()?.isRetryable ?? false),
    () => false,
  );
  const fileName = useSyncExternalStore(subscribeToNothing, pendingFileName, () => null);
  const [isRetrying, setIsRetrying] = useState(false);

  function retry() {
    setIsRetrying(true);
    // /processing resubmits the same in-memory file.
    router.push("/processing");
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-xl bg-surface-container-lowest p-4 border border-hairline shadow-sm space-y-4">
        <div className="flex items-start gap-3.5">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-tertiary-fixed flex items-center justify-center text-on-tertiary-fixed shadow-inner">
            <Icon name="report" size={24} />
          </div>
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-headline text-sm font-semibold text-on-surface tracking-tight">
                {failureCard.title}
              </h2>
              {failure && (
                <span className="font-label text-[10px] font-semibold text-on-tertiary-fixed bg-tertiary-fixed px-2 py-0.5 rounded-pill truncate">
                  {failure.code}
                </span>
              )}
            </div>
            <p role="alert" className="font-body text-[12px] text-on-surface leading-normal">
              {failure ? failure.message : failureCard.noFailure}
            </p>
            {failure && remedies[failure.code] && (
              <p className="font-body text-[12px] text-on-surface-variant leading-normal">
                {remedies[failure.code]}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container text-on-surface-variant">
          <Icon name="check_circle" size={16} className="text-primary flex-shrink-0" />
          <span className="font-body text-[11px] font-medium leading-tight">
            {failureCard.savedNote}
            {fileName ? ` (${fileName})` : ""}
          </span>
        </div>

        <div className="pt-1 flex flex-col gap-2.5">
          {canRetry && (
            <button
              type="button"
              onClick={retry}
              disabled={isRetrying}
              className="w-full h-11 px-4 rounded-lg bg-primary text-on-primary font-body text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.99] transition-[background-color,box-shadow,transform] shadow-sm shadow-primary/20 disabled:opacity-60"
            >
              <Icon name="refresh" size={18} className={isRetrying ? "animate-spin" : ""} />
              <span aria-live="polite">
                {isRetrying ? failureCard.retryingLabel : failureCard.retryLabel}
              </span>
            </button>
          )}
          <Link
            href="/upload"
            className="w-full h-10 px-4 rounded-lg bg-surface-container text-on-surface font-body text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-surface-container-high active:scale-[0.99] transition-all"
          >
            <Icon name="folder_open" size={16} className="text-on-surface-variant" />
            <span>{failureCard.chooseAnotherLabel}</span>
          </Link>
        </div>
      </div>
      <UssdGuidanceCard />
    </>
  );
}
