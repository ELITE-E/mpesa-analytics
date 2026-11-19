import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";

/**
 * Extra classes for a Door on a dark (inverse-surface) card: the dotted
 * underline and receipt glyph are lightened so they stay visible.
 */
export const DOOR_ON_DARK = "decoration-inverse-on-surface/50! [&>span]:text-inverse-on-surface/70!";

type DoorProps = {
  href: string;
  children: ReactNode;
  className?: string;
  /** Spoken label, e.g. "See the 14 rows behind KES 18,500.00". */
  label?: string;
};

/**
 * IA prototype: "every number is a door". A figure or phrase that opens the
 * Ledger rows it stands for: dotted underline at rest, a receipt glyph after
 * it. `href` must be a Ledger link already scoped by the caller (withImport).
 */
export function Door({ href, children, className = "", label }: DoorProps) {
  return (
    <Link
      href={href}
      title={label ?? "See the rows behind this figure"}
      className={`inline-flex items-baseline gap-0.5 underline decoration-dotted decoration-primary/50 underline-offset-4 hover:decoration-solid hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary rounded-xs tabular-nums ${className}`}
    >
      {children}
      {/* Read after the visible figure, so the link's name starts with what is shown. */}
      {label && <span className="sr-only"> {label}</span>}
      <Icon name="receipt_long" size={13} className="text-primary/70 no-underline self-center" />
    </Link>
  );
}
