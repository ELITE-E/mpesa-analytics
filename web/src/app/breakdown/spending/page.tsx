import { SpendingArea } from "@/components/spending/spending-area";
import { StoryScreen } from "@/components/story-screen";

/**
 * IA prototype: the Spending area of Breakdown ("What did I consume?") for
 * `?import=<id>` or the latest import, on the full page canvas. Its figures
 * come from the import's rows (loaded once for the page) and its analytics;
 * every figure opens its rows in Ledger, which links back here (?from=spending).
 */
export default function SpendingAreaPage() {
  // A static export cannot read the URL on the server. CP8b holds one session and shows its
  // latest statement; choosing another is CP9.
  const importId = null;
  return (
    <StoryScreen title="Spending" navKey="breakdown" importId={importId} loadTransactions wide>
      <SpendingArea importId={importId} />
    </StoryScreen>
  );
}
