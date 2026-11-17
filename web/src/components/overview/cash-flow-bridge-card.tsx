import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import { bridge } from "@/content/overview";
import { formatKes } from "@/lib/format";
import { ledgerHref } from "@/lib/ledger-link";
import type { OpeningBalance } from "@/lib/statement/balances";
import type { OverviewFigures } from "@/lib/statement/overview";

/** A cents amount as "KES 1,234.00", signed when asked. */
function kes(cents: number, signed = false) {
  return formatKes(cents / 100, { signed });
}

/** One tile of the bridge: a label, an amount, and a door to the rows when it has one. */
function BridgeTile({
  marker,
  label,
  amount,
  href,
  tileTone,
  labelTone,
  amountTone,
}: {
  marker: ReactNode;
  label: string;
  amount: ReactNode;
  /** Money in and out open their Ledger scopes; closing opens every row. */
  href?: string;
  tileTone: string;
  labelTone: string;
  amountTone: string;
}) {
  const content = (
    <>
      <span className={`font-body-sm text-body-sm flex items-center gap-space-2xs ${labelTone}`}>
        {marker}
        {label}
      </span>
      <span className={`font-label-numeric-md text-label-numeric-md mt-space-2xs tabular-nums break-words ${amountTone}`}>{amount}</span>
    </>
  );
  const classes = `${tileTone} rounded-xl p-space-sm flex flex-col justify-between min-w-0`;
  return href ? (
    <Link href={href} className={`${classes} hover:ring-2 hover:ring-primary/30 transition-shadow`}>
      {content}
      <span className="font-label-caps text-label-caps text-primary mt-space-2xs inline-flex items-center gap-0.5 normal-case tracking-normal">
        {bridge.seeRows}
        <Icon name="receipt_long" size={12} />
      </span>
    </Link>
  ) : (
    <div className={classes}>{content}</div>
  );
}

/** The note under the bridge: why the opening value is withheld or unchecked; null when O2 agrees. */
function openingNote(opening: OpeningBalance) {
  if (opening.check === "mismatch" && opening.o1Cents !== null && opening.o2.status === "computed") {
    return bridge.mismatch(kes(opening.o1Cents), kes(opening.o2.cents));
  }
  if (opening.check === "not-checked" && opening.o2.status === "unavailable") return bridge.notChecked[opening.o2.reason];
  return null;
}

/**
 * Opening → money in → money out → closing (DR-4, Q-D6). Opening is O1
 * (closing minus the API's net flow), labelled calculated, and checked
 * against O2 from the earliest row (U-4): when they disagree the opening
 * value is withheld and the note gives both (T-UNVERIFIED); when O2 can't be
 * computed the note says why. Money in, out and closing are the API's.
 */
export function CashFlowBridgeCard({
  figures,
  importId,
}: {
  figures: Pick<OverviewFigures, "moneyIn" | "moneyOut" | "closingCents"> & { bridge: NonNullable<OverviewFigures["bridge"]> };
  importId: number | null;
}) {
  const { opening } = figures.bridge;
  const note = openingNote(opening);
  const withheld = opening.check === "mismatch" || opening.o1Cents === null;
  const door = (scopeId: string | null) => ledgerHref({ scopeId, from: "overview", importId });
  return (
    <section className="bg-surface-container-lowest rounded-xl p-space-base border border-hairline shadow-sm">
      <div className="flex items-center justify-between mb-space-sm gap-space-xs">
        <div className="flex items-center gap-space-xs">
          <Icon name="account_tree" size={18} className="text-primary" />
          <h2 className="font-headline-sm text-headline-sm text-on-surface">{bridge.title}</h2>
        </div>
        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{bridge.tag}</span>
      </div>

      <div className="grid grid-cols-2 gap-space-xs">
        <BridgeTile
          marker={<span className="w-1.5 h-1.5 rounded-pill bg-secondary" />}
          label={bridge.opening}
          amount={withheld || opening.o1Cents === null ? <span data-opening-withheld="">{bridge.withheld}</span> : kes(opening.o1Cents)}
          tileTone="bg-surface-container-low"
          labelTone="text-on-surface-variant"
          amountTone="text-on-surface"
        />
        <BridgeTile
          marker={<Icon name="arrow_downward" size={14} />}
          label={bridge.moneyIn}
          amount={kes(figures.moneyIn.cents, true)}
          href={door(figures.moneyIn.scopeId)}
          tileTone="bg-primary-container/10"
          labelTone="text-primary font-medium"
          amountTone="text-primary font-semibold"
        />
        <BridgeTile
          marker={<Icon name="arrow_upward" size={14} />}
          label={bridge.moneyOut}
          amount={kes(-figures.moneyOut.cents)}
          href={door(figures.moneyOut.scopeId)}
          tileTone="bg-tertiary-container/10"
          labelTone="text-tertiary font-medium"
          amountTone="text-tertiary font-semibold"
        />
        <BridgeTile
          marker={<Icon name="account_balance_wallet" size={14} className="text-primary" />}
          label={bridge.closing}
          amount={kes(figures.closingCents)}
          href={door(null)}
          tileTone="bg-surface-container-high"
          labelTone="text-on-surface-variant font-medium"
          amountTone="text-on-surface font-semibold"
        />
      </div>

      {note && (
        <p data-bridge-note="" className="mt-space-sm flex items-start gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
          <Icon name="info" size={16} className="text-primary mt-0.5 shrink-0" />
          {note}
        </p>
      )}
    </section>
  );
}
