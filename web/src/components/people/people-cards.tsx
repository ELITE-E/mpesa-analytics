import Link from "next/link";
import { AreaHeader } from "@/components/analysis/area-header";
import { Door, DOOR_ON_DARK } from "@/components/analysis/door";
import { NoteCard } from "@/components/analysis/note-card";
import { MONEY_IN_ON_DARK as IN_TONE, MONEY_OUT_ON_DARK as OUT_TONE, Tinted } from "@/components/analysis/tinted";
import { SectionCard } from "@/components/analysis/section-card";
import { Icon } from "@/components/icon";
import { BREAKDOWN_AREAS } from "@/content/breakdown";
import { unverified } from "@/content/overview";
import { area, directions, largest, ownTransfer, peopleList, purpose, sendCost } from "@/content/people";
import { formatCount, formatDateTime, formatKes } from "@/lib/format";
import { withImport } from "@/lib/import-link";
import { ledgerHref } from "@/lib/ledger-link";
import type { PeopleBreakdown, PeopleFigures, PersonFigure, SendFigure } from "@/lib/statement/people";

type ShownBreakdown = Extract<PeopleBreakdown, { status: "shown" }>;

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** The Ledger link of a People door: scope `scopeId`, back to People, on import `importId`. */
function peopleDoor(scopeId: string, importId: number | null) {
  return ledgerHref({ scopeId, from: "people", importId });
}

/** The net sentence, worded by the sign of received minus sent. */
function netSentence(netCents: number) {
  if (netCents > 0) return area.moreReceived(kes(netCents));
  if (netCents < 0) return area.moreSent(kes(-netCents));
  return area.even;
}

/**
 * The People area's header (IA prototype AreaHeader): the question, the sent
 * figure as a door to every send, and an answer with both directions and the
 * net. Under T-UNVERIFIED the API's totals stay, without doors, beside
 * R2.2's wording; with no transfers it says so, over a real KES 0.00. Shown
 * on the dark card, with what was sent in money out's colour, what was
 * received in money in's, and the net in the colour of its direction.
 */
export function PeopleHeader({ api, breakdown, importId }: Pick<PeopleFigures, "api" | "breakdown"> & { importId: number | null }) {
  const header = { label: area.title, question: area.question, figureLabel: area.figureLabel, importId, tone: "dark" as const };
  if (!breakdown || breakdown.status === "unverified") {
    return (
      <AreaHeader
        {...header}
        figure={kes(api.sentCents)}
        answer={
          <div className="flex flex-col gap-space-xs">
            <p>
              <Tinted text={area.apiTotals(kes(api.sentCents), kes(api.receivedCents))} marks={[[kes(api.sentCents), OUT_TONE], [kes(api.receivedCents), IN_TONE]]} />
            </p>
            {breakdown && <p data-unverified="">{unverified}</p>}
          </div>
        }
      />
    );
  }
  if (breakdown.sent.count + breakdown.received.count === 0) return <AreaHeader {...header} figure={kes(0)} answer={<p>{area.none}</p>} />;
  const figure =
    breakdown.sent.count > 0 ? (
      <Door href={peopleDoor(breakdown.sent.scopeId, importId)} label={`See the ${formatCount(breakdown.sent.count, "send")} behind ${kes(breakdown.sent.cents)}`} className={DOOR_ON_DARK}>
        {kes(breakdown.sent.cents)}
      </Door>
    ) : (
      kes(0)
    );
  return (
    <AreaHeader
      {...header}
      figure={figure}
      answer={
        <div className="flex flex-col gap-space-xs">
          <p>
            <Tinted
              text={`${area.answer(kes(breakdown.sent.cents), breakdown.sent.people, kes(breakdown.received.cents), breakdown.received.people)} ${netSentence(breakdown.netCents)}`}
              marks={[
                [kes(breakdown.sent.cents), OUT_TONE],
                [kes(breakdown.received.cents), IN_TONE],
                [kes(Math.abs(breakdown.netCents)), breakdown.netCents > 0 ? IN_TONE : OUT_TONE],
              ]}
            />
          </p>
          <p className="flex items-center gap-space-2xs font-label-caps text-label-caps text-surface-container-highest/80 normal-case tracking-normal">
            <Icon name="info" size={14} className="text-primary-fixed-dim" />
            {area.derived}
          </p>
        </div>
      }
    />
  );
}

/** What the statement can't say: why money was sent (TRANSFER_OUT is NOT_DETERMINABLE). */
export function PurposeNote() {
  return (
    <NoteCard icon="help" title={purpose.title} tone="honest">
      <p>{purpose.body}</p>
      <p className="font-label-caps text-label-caps normal-case tracking-normal">{purpose.engine}</p>
    </NoteCard>
  );
}

/** A person's initials for the avatar; "?" for an unidentified name. */
function initials(person: PersonFigure) {
  if (person.label !== person.entity) return "?";
  return person.label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/** One direction of a person's money: a door to exactly those rows, named for screen readers; "—" when nothing moved that way. */
function DirectionAmount({ person, direction, importId }: { person: PersonFigure; direction: "sent" | "received"; importId: number | null }) {
  const figure = person[direction];
  const tone = direction === "sent" ? "text-on-surface" : "text-primary";
  if (!figure) return <span className={`font-label-numeric-sm text-label-numeric-sm tabular-nums ${tone} opacity-50`}>—</span>;
  return (
    <Link
      href={peopleDoor(figure.scopeId, importId)}
      aria-label={peopleList.doorLabel(direction, person.label, kes(figure.cents))}
      className={`font-label-numeric-sm text-label-numeric-sm tabular-nums ${tone} underline decoration-dotted decoration-primary/50 underline-offset-4 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-primary rounded-xs`}
    >
      {direction === "sent" ? "-" : "+"}
      {kes(figure.cents)}
    </Link>
  );
}

/**
 * Everyone money moved with (DR-8 groups of both directions, identity the
 * exact stored name): each person's sent and received amounts are doors to
 * their rows in that direction. Says plainly why one person can appear twice.
 */
export function PeopleListCard({ people, importId }: { people: PersonFigure[]; importId: number | null }) {
  return (
    <SectionCard icon="group" title={peopleList.title} subtitle={peopleList.subtitle}>
      {people.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{peopleList.none}</p>
      ) : (
        <ul className="flex flex-col gap-space-xs">
          {people.map((person) => (
            <li key={person.entity} className="flex items-center justify-between gap-space-sm p-space-sm rounded-lg bg-surface-container-low">
              <div className="flex items-center gap-space-sm min-w-0">
                <span
                  aria-hidden="true"
                  className="w-8 h-8 rounded-pill bg-secondary-container text-on-secondary-fixed-variant flex items-center justify-center font-headline text-xs font-bold shrink-0"
                >
                  {initials(person)}
                </span>
                <span className="font-body-sm text-body-sm font-semibold text-on-surface truncate">{person.label}</span>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <DirectionAmount person={person} direction="sent" importId={importId} />
                <DirectionAmount person={person} direction="received" importId={importId} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="font-body-sm text-body-sm text-on-surface-variant">{peopleList.identity}</p>
    </SectionCard>
  );
}

/** One of the largest sends: who, when, the principal and its linked charge; a door to its receipt. */
function SendRow({ send, importId }: { send: SendFigure; importId: number | null }) {
  return (
    <Link
      href={peopleDoor(send.scopeId, importId)}
      className="flex items-center justify-between gap-space-sm p-space-sm rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-space-xs min-w-0">
          <span className="receipt-badge shrink-0">{send.receiptNo}</span>
          <span className="font-body-sm text-body-sm font-semibold text-on-surface truncate">{send.label}</span>
        </div>
        <span className="font-label-caps text-label-caps text-on-surface-variant tabular-nums normal-case tracking-normal">{formatDateTime(send.time)}</span>
      </div>
      <div className="text-right shrink-0">
        <span className="block font-label-numeric-sm text-label-numeric-sm font-semibold text-on-surface tabular-nums">-{kes(send.cents)}</span>
        <span className={send.chargeCents > 0 ? "charge-pill tabular-nums" : "font-label-caps text-label-caps tabular-nums normal-case tracking-normal text-on-surface-variant"}>
          {send.chargeCents > 0 ? largest.charge(kes(send.chargeCents)) : largest.noCharge}
        </span>
      </div>
    </Link>
  );
}

/** The largest sends by principal, each opening its receipt, then one exit to every send in Ledger. */
export function LargestSendsCard({ sends, sendCount, importId }: { sends: SendFigure[]; sendCount: number; importId: number | null }) {
  return (
    <SectionCard
      icon="receipt_long"
      title={largest.title}
      subtitle={largest.subtitle}
      footer={
        sendCount > 0 ? (
          <Link
            href={peopleDoor("bucket:sent-to-people", importId)}
            className="w-full min-h-11 rounded-lg bg-primary text-on-primary flex items-center justify-center gap-space-xs font-body-sm text-body-sm font-semibold hover:bg-primary-container transition-colors"
          >
            {largest.exit(sendCount)}
            <Icon name="arrow_forward" size={16} />
          </Link>
        ) : undefined
      }
    >
      {sends.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{largest.none}</p>
      ) : (
        <div className="flex flex-col gap-space-xs">
          {sends.map((send) => (
            <SendRow key={send.receiptNo} send={send} importId={importId} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** One direction tile: label, the amount as a door to its bucket's rows (when there are any), and its detail. */
function DirectionTile({ label, cents, count, detail, scopeId, tone, importId }: { label: string; cents: number; count: number; detail: string; scopeId: string; tone: string; importId: number | null }) {
  return (
    <div className="bg-surface-container-low rounded-xl p-space-sm flex flex-col gap-space-2xs min-w-0">
      <span className={`font-label-caps text-label-caps uppercase ${tone}`}>{label}</span>
      {count > 0 ? (
        <Door href={peopleDoor(scopeId, importId)} className="font-label-numeric-md text-label-numeric-md font-bold text-on-surface">
          {kes(cents)}
        </Door>
      ) : (
        <span className="font-label-numeric-md text-label-numeric-md font-bold text-on-surface tabular-nums">{kes(cents)}</span>
      )}
      <span className="font-body-sm text-body-sm text-on-surface-variant">{detail}</span>
    </div>
  );
}

/** Sent and received side by side, each a door to its bucket; received money is part of Money In, linked to its screen. */
export function DirectionsCard({ breakdown, importId }: { breakdown: ShownBreakdown; importId: number | null }) {
  const moneyIn = BREAKDOWN_AREAS.find((entry) => entry.id === "money-in")?.destination;
  return (
    <SectionCard icon="swap_vert" title={directions.title}>
      <div className="grid grid-cols-2 gap-space-xs">
        <DirectionTile
          label={directions.sent}
          cents={breakdown.sent.cents}
          count={breakdown.sent.count}
          detail={directions.sentDetail(formatCount(breakdown.sent.count, "send"), breakdown.sent.people)}
          scopeId={breakdown.sent.scopeId}
          tone="text-tertiary"
          importId={importId}
        />
        <DirectionTile
          label={directions.received}
          cents={breakdown.received.cents}
          count={breakdown.received.count}
          detail={directions.receivedDetail(formatCount(breakdown.received.count, "payment"), breakdown.received.people)}
          scopeId={breakdown.received.scopeId}
          tone="text-primary"
          importId={importId}
        />
      </div>
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        {directions.moneyIn}{" "}
        {moneyIn ? (
          <Link href={withImport(moneyIn.href, importId)} className="text-primary font-semibold hover:underline">
            {directions.moneyInLink}
          </Link>
        ) : (
          directions.moneyInLink
        )}
        .
      </p>
    </SectionCard>
  );
}

/**
 * What sending cost: the charges linked to sends (Q-LINK), display only and
 * without a door, counted once in Fees, which is linked by its existing
 * screen.
 */
export function SendCostCard({ sendCharges, importId }: { sendCharges: ShownBreakdown["sendCharges"]; importId: number | null }) {
  const fees = BREAKDOWN_AREAS.find((entry) => entry.id === "fees")?.destination;
  return (
    <SectionCard icon="receipt" title={sendCost.title}>
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        {sendCharges.count > 0 ? sendCost.carried(kes(sendCharges.cents), sendCharges.count) : sendCost.none}{" "}
        {fees ? (
          <Link href={withImport(fees.href, importId)} className="text-primary font-semibold hover:underline">
            {sendCost.fees}
          </Link>
        ) : (
          sendCost.fees
        )}
        .
      </p>
    </SectionCard>
  );
}

/** Own-account transfers can't be detected yet: a T-PLANNED note (Q-P1 label), no figure and no link. */
export function OwnTransferNote() {
  return (
    <NoteCard icon="sync_alt" title={ownTransfer.title} planned={ownTransfer.planned}>
      <p>{ownTransfer.body}</p>
    </NoteCard>
  );
}
