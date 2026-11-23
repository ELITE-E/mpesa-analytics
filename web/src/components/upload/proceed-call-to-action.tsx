import { Icon } from "@/components/icon";
import { proceedCallToAction } from "@/content/upload";

// Colours and shadow may animate; opacity never does, so the label is never caught mid-fade at low
// contrast when the button becomes enabled (found by axe in CI).
const BUTTON_CLASSES =
  "w-full h-12 bg-primary-container text-on-primary rounded-lg font-headline text-sm font-semibold flex items-center justify-center gap-2 shadow-md hover:bg-primary transition-[background-color,box-shadow]";

export function ProceedCallToAction({
  disabled,
  onProceed,
}: {
  disabled: boolean;
  onProceed: () => void;
}) {
  const content = (
    <>
      <span>{proceedCallToAction.label}</span>
      <Icon name="arrow_forward" size={18} />
    </>
  );

  return (
    <div className="space-y-2 pt-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onProceed}
        className={`${BUTTON_CLASSES} disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {content}
      </button>
      <div className="flex items-center justify-center gap-1.5 text-[11px] font-body text-on-surface-variant">
        <Icon name="security" size={13} className="text-primary" />
        <span>{proceedCallToAction.reassurance}</span>
      </div>
    </div>
  );
}
