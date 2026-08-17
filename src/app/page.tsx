import App from "@/components/App";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Land on the conversation where Ryan states the organization rule — that is
  // the setup for Demo 1, so a reviewer sees where the rule came from before
  // watching it reach someone else. The sidebar's "Run the guided demo" button
  // jumps straight to Sean's empty session from here.
  const initial = await loadState("u_ryan", "s_ryan_2");
  return <App initial={initial} />;
}
