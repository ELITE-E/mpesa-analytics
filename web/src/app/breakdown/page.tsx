import { BreakdownNav } from "@/components/analysis/breakdown-nav";
import { BreakdownHub } from "@/components/breakdown/breakdown-hub";
import { StoryScreen } from "@/components/story-screen";
import { hub } from "@/content/breakdown";

/**
 * IA prototype: the analysis home ("Why?"), for `?import=<id>` or the latest
 * import (migration Stage 8a). Every area is a card that opens its screen;
 * with the import's analytics and rows (loaded once for the page) each shows
 * its headline, and "How the parts add up" shows every outflow bucket adding
 * back to money out.
 */
export default function BreakdownPage() {
  // A static export cannot read the URL on the server. CP8b holds one session and shows its
  // latest statement; choosing another is CP9.
  const importId = null;
  return (
    <StoryScreen title={hub.title} navKey="breakdown" importId={importId} loadTransactions wide>
      <BreakdownNav importId={importId} />
      <BreakdownHub importId={importId} />
    </StoryScreen>
  );
}
