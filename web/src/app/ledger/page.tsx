import { Suspense } from "react";
import { LedgerFromUrl } from "@/components/ledger/ledger-from-url";
import { StoryScreen } from "@/components/story-screen";

/**
 * The Ledger of the session's latest statement, which loads the
 * import's transactions once for the page. `?scope=` names the rows shown and
 * `?from=` the screen to go back to (decision Q-R2); earlier links still work
 * through their legacy parameters:
 *   ?filter=unmapped | fees | investments   named views
 *   ?merchant=<entity>                       one recipient (/spending)
 *   ?receipt=<code>                          one receipt (/spending)
 * Its grid uses the full page canvas (`wide`).
 */
export default function LedgerPage() {
  // A static export cannot read the URL on the server: the scope is read in the browser
  // (LedgerFromUrl), and CP8b shows the session's latest statement (choosing another is CP9).
  const importId = null;
  return (
    <StoryScreen title="Ledger" navKey="ledger" importId={importId} loadTransactions wide>
      <Suspense>
        <LedgerFromUrl importId={importId} />
      </Suspense>
    </StoryScreen>
  );
}
