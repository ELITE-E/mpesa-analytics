"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";
import { pipelineCard, stages, type PipelineStage } from "@/content/processing";
import type { UploadProgress } from "@/lib/api";
import {
  cancelPendingUpload,
  hasPendingUpload,
  submitPendingUpload,
  subscribeUploadProgress,
  uploadProgress,
} from "@/lib/upload-flow";

type StageStatus = "done" | "active" | "queued";

function StageMarker({ status }: { status: StageStatus }) {
  if (status === "done") {
    return (
      <div className="w-6 h-6 rounded-pill bg-primary flex items-center justify-center shrink-0 z-10">
        <Icon name="check" size={14} className="text-white" />
      </div>
    );
  }
  if (status === "active") {
    return (
      <div className="w-6 h-6 rounded-pill bg-surface-container-highest flex items-center justify-center shrink-0 z-10 relative">
        <span className="w-2.5 h-2.5 rounded-pill bg-tertiary-container animate-ping absolute opacity-75" />
        <span className="w-2 h-2 rounded-pill bg-tertiary-container relative z-10" />
      </div>
    );
  }
  return (
    <div className="w-6 h-6 rounded-pill bg-surface-container flex items-center justify-center shrink-0 z-10">
      <span className="w-1.5 h-1.5 rounded-pill bg-outline-variant" />
    </div>
  );
}

function StageStatusLabel({ stage, status }: { stage: PipelineStage; status: StageStatus }) {
  if (status === "done") {
    return (
      <span className="font-label text-[10px] text-primary uppercase font-semibold tabular-nums shrink-0">
        {stage.doneLabel}
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="font-label text-[9px] px-1.5 py-0.5 rounded-xs bg-tertiary-fixed text-on-tertiary-fixed font-semibold tracking-wider uppercase shrink-0">
        {pipelineCard.inProgressLabel}
      </span>
    );
  }
  return (
    <span className="font-label text-[10px] text-on-surface-variant shrink-0">
      {pipelineCard.queuedLabel}
    </span>
  );
}

function StageRow({ stage, status, note }: { stage: PipelineStage; status: StageStatus; note?: string }) {
  return (
    <div className={`flex items-start gap-3 relative ${status === "queued" ? "opacity-55" : ""}`}>
      <StageMarker status={status} />
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <p
            className={`font-headline text-xs text-on-surface ${
              status === "queued" ? "font-medium" : "font-semibold"
            }`}
          >
            {stage.title}
          </p>
          <StageStatusLabel stage={stage} status={status} />
        </div>
        <p className="font-body text-[11px] text-on-surface-variant mt-0.5">{stage.detail}</p>
        {note && <p className="font-label text-[11px] text-primary mt-0.5 tabular-nums">{note}</p>}
      </div>
    </div>
  );
}

/**
 * Each stage's status for the engine's latest step (CP8b). Reading pages is the first stage; the
 * core's one call covers normalising and classifying; loading pandas marks the narrative stage.
 *
 * @param phase "saved" once the statement is read, otherwise the run's phase.
 * @param step The engine's latest step, or null before it reports one.
 * @returns One status per stage.
 */
function stageStatuses(phase: string, step: UploadProgress | null): StageStatus[] {
  if (phase === "saved") return stages.map(() => "done");
  const reached = step?.stage === "analysis" ? 3 : step?.stage === "core" ? 1 : 0;
  return stages.map((_, index) => {
    if (index < reached) return "done";
    if (index === reached || (reached === 1 && index === 2)) return "active";
    return "queued";
  });
}

function subscribeToNothing() {
  return () => {};
}

// Reads the statement chosen on /upload with the local statement engine. Each
// stage follows the engine's progress (pages read, then the core, then the
// analysis); "Stop reading" cancels it. Any failure, a cancel included, goes to
// /recovery (CP8b).
export function ProcessingPipeline() {
  const router = useRouter();
  // Read on the client only: the server prerender has no chosen file.
  const hasUpload = useSyncExternalStore(subscribeToNothing, hasPendingUpload, () => null);
  const [outcome, setOutcome] = useState<"pending" | "saved" | "failed">("pending");
  const [importId, setImportId] = useState<number | null>(null);
  const step = useSyncExternalStore(subscribeUploadProgress, uploadProgress, () => null);

  useEffect(() => {
    if (!hasPendingUpload()) return;
    let cancelled = false;
    submitPendingUpload().then(
      (created) => {
        if (cancelled) return;
        setImportId(created.import.id);
        setOutcome("saved");
        router.replace(`/analysis-summary?import=${created.import.id}`);
      },
      () => {
        if (cancelled) return;
        setOutcome("failed");
        router.replace("/recovery");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (hasUpload === null) return null;
  const phase = outcome !== "pending" || hasUpload ? outcome : "missing";

  if (phase === "missing") {
    return (
      <div className="px-4 mt-3">
        <div className="bg-surface-container-lowest rounded-lg p-4 border border-hairline shadow-sm flex flex-col gap-3">
          <p className="font-body text-xs text-on-surface-variant">{pipelineCard.noStatement}</p>
          <Link
            href="/upload"
            className="self-start inline-flex items-center gap-1.5 py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold"
          >
            {pipelineCard.noStatementAction}
          </Link>
        </div>
      </div>
    );
  }

  const statuses = stageStatuses(phase, step);
  const pageNote = step?.stage === "reading" && step.page && step.page_count ? pipelineCard.pageProgress(step.page, step.page_count) : undefined;

  return (
    <div className="px-4 mt-3 flex flex-col gap-3">
      <div className="bg-surface-container-lowest rounded-lg p-4 border border-hairline shadow-sm relative overflow-hidden">
        <div className="flex items-center justify-between pb-3 mb-4 bg-surface-container-low -mx-4 -mt-4 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Icon name="sync" size={16} className="text-primary" />
            <span className="font-label text-[11px] font-medium text-on-surface uppercase">
              {pipelineCard.title}
            </span>
          </div>
          <span className="font-label text-[11px] text-on-surface-variant font-medium tabular-nums">
            {importId ? `IMPORT #${importId}` : pipelineCard.pendingId}
          </span>
        </div>

        <div className="flex flex-col gap-4 relative" aria-live="polite">
          <div className="absolute left-[11px] top-3 bottom-3 w-[1.5px] bg-surface-container" />
          {stages.map((stage, index) => (
            <StageRow
              key={stage.title}
              stage={stage}
              status={statuses[index]}
              note={index === 0 && statuses[0] === "active" ? pageNote : undefined}
            />
          ))}
        </div>

        <div className="mt-5 pt-3 bg-surface-container-low -mx-4 -mb-4 px-4 py-3 flex items-center gap-2 rounded-b-lg">
          <Icon name="hourglass_top" size={15} className="text-primary" />
          <span className="font-body text-[11px] text-on-surface-variant font-medium flex-1">
            {pipelineCard.footnote}
          </span>
          {phase === "pending" && (
            <button
              type="button"
              onClick={cancelPendingUpload}
              className="shrink-0 py-1.5 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-headline text-xs font-medium"
            >
              {pipelineCard.cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
