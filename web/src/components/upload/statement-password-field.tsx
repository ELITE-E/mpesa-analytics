import { Icon } from "@/components/icon";
import { passwordField } from "@/content/upload";

// Not in Stitch. The password stays in memory and goes only to the statement
// engine in this browser, once; it is never stored (CP8b).
export function StatementPasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="bg-surface-container-low rounded-xl p-4 flex flex-col gap-2">
      <span className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold flex items-center gap-1">
        <Icon name="key" size={13} className="text-primary" />
        {passwordField.label}
      </span>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        inputMode="text"
        maxLength={128}
        className="w-full h-11 px-3 rounded-lg bg-surface-container-lowest text-on-surface font-label text-sm tracking-widest focus-visible:outline-2 focus-visible:outline-primary-container"
      />
      <span className="font-body text-[11px] text-on-surface-variant">{passwordField.hint}</span>
    </label>
  );
}
