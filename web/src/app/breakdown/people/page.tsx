import { PeopleArea } from "@/components/people/people-area";
import { StoryScreen } from "@/components/story-screen";

/**
 * IA prototype: the People area of Breakdown ("How much money moved between
 * me and other people?") for `?import=<id>` or the latest import, on the full
 * page canvas. Its figures come from the import's analytics and rows (loaded
 * once for the page); every figure opens its rows in Ledger, which links back
 * here (?from=people).
 */
export default function PeopleAreaPage() {
  // A static export cannot read the URL on the server. CP8b holds one session and shows its
  // latest statement; choosing another is CP9.
  const importId = null;
  return (
    <StoryScreen title="People" navKey="breakdown" importId={importId} loadTransactions wide>
      <PeopleArea importId={importId} />
    </StoryScreen>
  );
}
