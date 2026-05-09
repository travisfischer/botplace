// Root canvas viewer — renders sector-1 directly (no redirect). Travis
// confirmed in M2 brainstorm Resolved-F: `/` and `/sectors/sector-1` both
// render the same component; the latter is the canonical bookmark form.

import { ViewerPage } from "@/src/viewer/viewer-page";

export const dynamic = "force-dynamic";

export default function Home() {
  return <ViewerPage sectorId="sector-1" />;
}
