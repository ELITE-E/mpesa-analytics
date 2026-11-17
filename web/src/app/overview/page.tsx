import { OverviewView } from "@/components/overview/overview-view";
import { StoryScreen } from "@/components/story-screen";

// IA prototype: Overview, the story level, for `?import=<id>` or the latest
// import. Its figures come from the import's summary, analytics and
// transactions (loaded once for the page), on the full page canvas like the
// prototype's.
export default function OverviewPage() {
  // A static export cannot read the URL on the server. CP8b holds one session and shows its
  // latest statement; choosing another is CP9.
  const importId = null;
  return (
    <StoryScreen title="Overview" navKey="overview" importId={importId} loadTransactions wide>
      <OverviewView importId={importId} />
    </StoryScreen>
  );
}
