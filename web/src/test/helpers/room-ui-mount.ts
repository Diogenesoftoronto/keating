/**
 * Reconciler host for the study-room UI tests: like react-mount, but exposes
 * the rendered host tree so tests can find controls and call their handlers.
 */
import { createRequire } from "node:module";
import type { ReactNode } from "react";
import * as ReactWeb from "react";

export type HostNode = { type: string; props: Record<string, any>; children: HostNode[]; text?: string; focus: () => void };
type HostContainer = { children: HostNode[] };

const require = createRequire(import.meta.url);
// Prefer a reconciler built for React 19. Some checkouts keep an older
// react-reconciler under web/node_modules next to the workspace-root copy.
function resolveReconciler(): string {
  const candidates = [require.resolve("react-reconciler")];
  try {
    candidates.unshift(require.resolve("react-reconciler", { paths: [new URL("../../../../", import.meta.url).pathname] }));
  } catch {
    // Only the local copy exists.
  }
  for (const candidate of candidates) {
    const version = String(createRequire(candidate)("./package.json").version ?? "0");
    if (Number(version.split(".")[1]) >= 31) return candidate;
  }
  return candidates.at(-1)!;
}
const reconcilerRequire = createRequire(resolveReconciler());
const reconcilerReact = reconcilerRequire("react") as Record<string, any>;
const webReact = ReactWeb as Record<string, any>;
const reconcilerInternals = reconcilerReact.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const webInternals = webReact.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
if (reconcilerInternals !== webInternals) {
  Object.defineProperty(webInternals, "H", {
    configurable: true,
    get: () => reconcilerInternals.H,
    set: (dispatcher) => { reconcilerInternals.H = dispatcher; },
  });
}

const createReconciler = reconcilerRequire("react-reconciler") as (hostConfig: Record<string, unknown>) => {
  createContainer: (...args: unknown[]) => unknown;
  updateContainer: (children: ReactNode | null, root: unknown, parent: null) => void;
};
let updatePriority = 32;
const node = (type: string, props: Record<string, any>, text?: string): HostNode =>
  ({ type, props, children: [], ...(text !== undefined ? { text } : {}), focus: () => {} });
const hostConfig = {
  supportsMutation: true,
  isPrimaryRenderer: false,
  warnsIfNotActing: false,
  now: Date.now,
  getRootHostContext: () => ({}),
  getChildHostContext: (context: object) => context,
  getPublicInstance: (instance: HostNode) => instance,
  prepareForCommit: () => null,
  resetAfterCommit: () => {},
  createInstance: (type: string, props: Record<string, any>) => node(type, props),
  appendInitialChild: (parent: HostNode, child: HostNode) => parent.children.push(child),
  appendChild: (parent: HostNode, child: HostNode) => parent.children.push(child),
  appendChildToContainer: (parent: HostContainer, child: HostNode) => parent.children.push(child),
  removeChild: (parent: HostNode, child: HostNode) => parent.children.splice(parent.children.indexOf(child), 1),
  removeChildFromContainer: (parent: HostContainer, child: HostNode) => parent.children.splice(parent.children.indexOf(child), 1),
  insertBefore: (parent: HostNode, child: HostNode, before: HostNode) => parent.children.splice(parent.children.indexOf(before), 0, child),
  insertInContainerBefore: (parent: HostContainer, child: HostNode, before: HostNode) => parent.children.splice(parent.children.indexOf(before), 0, child),
  finalizeInitialChildren: () => false,
  prepareUpdate: () => null,
  commitUpdate: (instance: HostNode, _type: string, _previous: unknown, next: Record<string, any>) => { instance.props = next; },
  commitTextUpdate: (instance: HostNode, _previous: string, next: string) => { instance.text = next; },
  createTextInstance: (text: string) => node("#text", {}, text),
  shouldSetTextContent: () => false,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  getCurrentEventPriority: () => 16,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,
  getCurrentUpdatePriority: () => updatePriority,
  setCurrentUpdatePriority: (priority: number) => { updatePriority = priority; },
  resolveUpdatePriority: () => updatePriority,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => Date.now(),
  trackSchedulerEvent: () => {},
  detachDeletedInstance: () => {},
  clearContainer: (container: HostContainer) => { container.children = []; },
};
const reconciler = createReconciler(hostConfig);

export function textOf(target: HostNode | HostContainer): string {
  return target.children.map((child) => child.text ?? textOf(child)).join("");
}

function walk(target: HostNode | HostContainer, out: HostNode[] = []): HostNode[] {
  for (const child of target.children) {
    out.push(child);
    walk(child, out);
  }
  return out;
}

export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

export function mountRoomUi() {
  const container: HostContainer = { children: [] };
  const root = reconciler.createContainer(container, 0, null, false, null, "", console.error, console.error, console.error, null);
  return {
    async render(children: ReactNode) {
      reconciler.updateContainer(children, root, null);
      await settle();
    },
    async unmount() {
      reconciler.updateContainer(null, root, null);
      await settle();
    },
    text: () => textOf(container),
    all: (type: string) => walk(container).filter((item) => item.type === type),
    /** The button whose visible text or aria-label includes `label`. */
    button(label: string): HostNode {
      const found = walk(container).find((item) =>
        item.type === "button" && (textOf(item).includes(label) || String(item.props["aria-label"] ?? "").includes(label)));
      if (!found) throw new Error(`No button "${label}" in: ${textOf(container)}`);
      return found;
    },
  };
}
