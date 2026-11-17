import { SavingsArea } from "@/components/savings/savings-area";
import { StoryScreen } from "@/components/story-screen";

/**
 * IA prototype: the Savings & Investments area of Breakdown ("How much did I
 * set aside?") for `?import=<id>` or the latest import, on the full page
 * canvas. Its figures come from the import's analytics and rows (loaded once
 * for the page); every figure opens its rows in Ledger, which links back here
 * (?from=savings).
 */
export default function SavingsAreaPage() {
  // A static export cannot read the URL on the server. CP8b holds one session and shows its
  // latest statement; choosing another is CP9.
  const importId = null;
  return (
    <StoryScreen title="Savings & Investments" navKey="breakdown" importId={importId} loadTransactions wide>
      <SavingsArea importId={importId} />
    </StoryScreen>
  );
}
