import { FeesArea } from "@/components/fees/fees-area";
import { StoryScreen } from "@/components/story-screen";

/**
 * IA prototype: the Fees area of Breakdown ("What did moving my money
 * cost?") for `?import=<id>` or the latest import, on the full page canvas.
 * Its figures come from the import's analytics and rows (loaded once for the
 * page); every figure opens its rows in Ledger, which links back here
 * (?from=fees).
 */
export default function FeesAreaPage() {
  // A static export cannot read the URL on the server. CP8b holds one session and shows its
  // latest statement; choosing another is CP9.
  const importId = null;
  return (
    <StoryScreen title="Fees" navKey="breakdown" importId={importId} loadTransactions wide>
      <FeesArea importId={importId} />
    </StoryScreen>
  );
}
