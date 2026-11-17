import { Icon } from "@/components/icon";
import { pipeline, pipelineSteps, type PipelineStep } from "@/content/upload";

function StepCard({ step, index, isCurrent }: { step: PipelineStep; index: number; isCurrent: boolean }) {
  return (
    <div className="bg-surface-container-low rounded-lg p-2.5 flex flex-col justify-between space-y-2">
      <div className="flex items-center justify-between">
        <span
          className={`w-5 h-5 rounded-pill font-label text-[10px] font-bold flex items-center justify-center ${
            isCurrent
              ? "bg-primary text-on-primary"
              : "bg-surface-container-highest text-on-surface"
          }`}
        >
          {index + 1}
        </span>
        <Icon
          name={step.icon}
          size={14}
          className={isCurrent ? "text-primary" : "text-on-surface-variant"}
        />
      </div>
      <div className="space-y-0.5">
        <span className="font-headline text-xs font-bold text-on-surface leading-tight block">
          {step.title}
        </span>
        <span className="font-body text-[10px] text-on-surface-variant leading-tight block">
          {step.detail}
        </span>
      </div>
    </div>
  );
}

/** The three audit stages; `current` is the zero-based stage in progress. */
export function PipelineSteps({ current = 0 }: { current?: number }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-3.5 border border-hairline shadow-sm space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
          {pipeline.title}
        </span>
        <span className="font-label text-[10px] text-primary font-medium">{pipeline.badge}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {pipelineSteps.map((step, index) => (
          <StepCard key={step.title} step={step} index={index} isCurrent={index === current} />
        ))}
      </div>
    </div>
  );
}
