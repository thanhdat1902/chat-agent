import App from "@/components/App";
import { loadState, pickLandingSession } from "@/lib/state";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Nothing is hardcoded: land on the first user's most substantial
  // conversation when there is one, otherwise their only chat.
  const { userId, sessionId } = await pickLandingSession();
  const initial = await loadState(userId, sessionId);
  return <App initial={initial} />;
}
