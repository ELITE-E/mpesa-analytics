import { CashArea } from "@/components/cash/cash-area";
import { StoryScreen } from "@/components/story-screen";

/**
 * IA prototype: the Cash area of Breakdown ("What happened with cash
 * withdrawals?") for `?import=<id>` or the latest import, on the full page
 * canvas. Its figures come from the import's rows (loaded once for the
 * page); every figure opens its rows in Ledger, which links back here
 * (?from=cash).
 */
export default function CashAreaPage() {
  // A static export cannot read the URL on the server. CP8b holds one session and shows its
  // latest statement; choosing another is CP9.
  const importId = null;
  return (
    <StoryScreen title="Cash" navKey="breakdown" importId={importId} loadTransactions wide>
      <CashArea importId={importId} />
    </StoryScreen>
  );
}
