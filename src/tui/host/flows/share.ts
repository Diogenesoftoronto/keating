/**
 * Publish a read-only copy of the current session after explicit confirmation.
 */
import { publishTuiSession } from "../../share.js";
import { sanitizeDiagnostic } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { busySurfaceNotice, restoreIdleStatus } from "./common.js";

export type ShareDeps = Pick<HostContext, "client" | "dialogs" | "state" | "surface" | "view">;

export async function showShareSession(deps: ShareDeps): Promise<void> {
  const { client, surface, state } = deps;
  const { appendEntry, status, composer: input } = deps.view;
  if (busySurfaceNotice(deps, "Session sharing")) return;
  const confirmed = await surface.presentConfirm(
    "Publish a read-only session?",
    "This sends the user and assistant text in the current session to the configured Keating share server. Tool calls, credentials, and local files are excluded.",
  );
  if (!confirmed) return;
  status.content = "Publishing read-only session…";
  try {
    const shared = await publishTuiSession(await client.getMessages(), {
      model: state.headerState.model,
      thinking: state.headerState.thinking,
    });
    input.value = shared.url;
    appendEntry({
      id: `share-${shared.id}`,
      kind: "artifact",
      title: "Session shared",
      body: `${shared.url}\n\n${shared.messageCount} text message${shared.messageCount === 1 ? "" : "s"} published as a read-only web session. The link is also in the composer for copying.`,
    });
  } catch (error) {
    appendEntry({
      id: `share-error-${Date.now()}`,
      kind: "error",
      title: "Session was not shared",
      body: `${sanitizeDiagnostic(error)}\n\nNo public link was created. Set KEATING_SHARE_ORIGIN to a reachable Keating web deployment, then retry from Ctrl+P.`,
    });
  } finally {
    restoreIdleStatus(deps);
  }
}
