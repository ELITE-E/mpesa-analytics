"use client";

import { Icon } from "@/components/icon";
import { checks as copy } from "@/content/analysis-summary";
import { getStatementChecks, type StatementChecks } from "@/lib/api";
import { useApiData } from "@/lib/use-api";

/**
 * The statement's checks (CP8b item 5): its verification code and how to verify it with
 * Safaricom, in the statement's own printed words (or a fallback sentence, never an assumed code), whether the balances chain, whether the totals match the printed summary, and the
 * rows no rule recognised. It never calls the statement verified or genuine: only Safaricom can.
 *
 * @param props.checks The statement's checks, from the data layer.
 * @returns The card.
 */
export function StatementChecksCard({ checks }: { checks: StatementChecks }) {
  const passes = checks.chain_breaks === 0 && checks.totals_match === "yes";
  const share = `${(Math.round(checks.unclassified_share * 1000) / 10).toFixed(1)}%`;
  return (
    <div className="rounded-xl bg-surface-container-lowest shadow-sm p-5 flex flex-col gap-3" data-statement-checks="">
      <div className="flex items-center gap-2">
        <Icon name="fact_check" size={18} className="text-primary" />
        <span className="text-xs font-headline font-semibold text-on-surface">{copy.title}</span>
      </div>
      <p className="text-sm font-body text-on-surface">{passes ? copy.passes : copy.doesNotPass}</p>
      <div className="p-3 rounded-lg bg-surface-container-low flex flex-col gap-1">
        <span className="text-xs font-label text-on-surface-variant">
          {copy.verificationLabel}:{" "}
          <span className="font-semibold text-on-surface">{checks.verification_token || copy.tokenNotKept}</span>
        </span>
        <span className="text-xs font-label text-on-surface-variant">
          {copy.verifyWithSafaricom}:{" "}
          <span className="text-on-surface" data-verification-instruction="">
            {checks.verification_instruction ?? copy.instructionUnreadable}
          </span>
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-xs font-body text-on-surface-variant">
        <li>{checks.chain_breaks > 0 ? copy.chainBreaks(checks.chain_breaks) : copy.chainHolds}</li>
        <li>{copy.totals[checks.totals_match]}</li>
        <li>{copy.uncategorised(checks.unclassified_rows, share)}</li>
      </ul>
    </div>
  );
}

/**
 * The checks card for one statement of the session, loaded from the data layer. Shows nothing
 * until they arrive or if they cannot be loaded; the rest of the summary stays.
 *
 * @param props.importId The statement's local id.
 * @returns The card, or nothing.
 */
export function StatementChecksForImport({ importId }: { importId: number }) {
  const { state } = useApiData(() => getStatementChecks(importId), `statement-checks:${importId}`);
  return state.status === "ready" ? <StatementChecksCard checks={state.data} /> : null;
}
