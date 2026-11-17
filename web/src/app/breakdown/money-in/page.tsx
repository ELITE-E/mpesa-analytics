import { MoneyInArea } from "@/components/money-in/money-in-area";
import { StoryScreen } from "@/components/story-screen";

/**
 * IA prototype: the Money In area of Breakdown ("Where did my money come
 * from?") for `?import=<id>` or the latest import, on the full page canvas.
 * Its figures come from the import's analytics and rows (loaded once for the
 * page); every figure opens its rows in Ledger, which links back here
 * (?from=money-in).
 */
export default function MoneyInAreaPage() {
  // A static export cannot read the URL on the server. CP8b holds one session and shows its
  // latest statement; choosing another is CP9.
  const importId = null;
  return (
    <StoryScreen title="Money In" navKey="breakdown" importId={importId} loadTransactions wide>
      <MoneyInArea importId={importId} />
    </StoryScreen>
  );
}
