import App from "@/components/App";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initial = await loadState("u_ryan", null);
  return <App initial={initial} />;
}
