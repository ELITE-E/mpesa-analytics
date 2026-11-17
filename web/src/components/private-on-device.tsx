import { Icon } from "@/components/icon";

/**
 * Where the account button was: a plain statement that the statement is read and kept on this
 * device only. There is no account, so there is nothing to sign in or out of.
 *
 * @returns {JSX.Element} The label.
 */
export function PrivateOnDevice() {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-surface-container px-2 py-1 text-xs font-medium text-on-surface-variant">
      <Icon name="lock" size={14} />
      Private on this device
    </span>
  );
}
