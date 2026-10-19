/** Minimal React reconciler host for exercising component mount and effect lifecycles without a browser DOM. */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import * as ReactWeb from "react";

type HostNode = { type: string; props: Record<string, unknown>; children: HostNode[]; text?: string };
type HostContainer = { children: HostNode[] };

const require = createRequire(import.meta.url);
const reconcilerRequire = createRequire(require.resolve("react-reconciler"));
const reconcilerReact = reconcilerRequire("react") as Record<string, any>;
const webReact = ReactWeb as Record<string, any>;
const reconcilerInternals = reconcilerReact.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const webInternals = webReact.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
if (reconcilerInternals !== webInternals) {

	// The monorepo has separate root and web React installs; share only the active
	// hook dispatcher so this custom host runs the web component's real effects.
	Object.defineProperty(webInternals, "H", {
		configurable: true,
		get: () => reconcilerInternals.H,
		set: (dispatcher) => { reconcilerInternals.H = dispatcher; },
	});
}

const createReconciler = reconcilerRequire("react-reconciler") as (hostConfig: Record<string, unknown>) => {
  createContainer: (...args: unknown[]) => unknown;
  updateContainer: (children: ReactNode | null, root: unknown, parent: null, callback?: () => void) => void;
};
let updatePriority = 32;

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
  createInstance: (type: string, props: Record<string, unknown>): HostNode => ({ type, props, children: [] }),
  appendInitialChild: (parent: HostNode, child: HostNode) => parent.children.push(child),
  appendChild: (parent: HostNode, child: HostNode) => parent.children.push(child),
  appendChildToContainer: (parent: HostContainer, child: HostNode) => parent.children.push(child),
  removeChild: (parent: HostNode, child: HostNode) => parent.children.splice(parent.children.indexOf(child), 1),
  removeChildFromContainer: (parent: HostContainer, child: HostNode) => parent.children.splice(parent.children.indexOf(child), 1),
  insertBefore: (parent: HostNode, child: HostNode, before: HostNode) => parent.children.splice(parent.children.indexOf(before), 0, child),
  insertInContainerBefore: (parent: HostContainer, child: HostNode, before: HostNode) => parent.children.splice(parent.children.indexOf(before), 0, child),
  finalizeInitialChildren: () => false,
  prepareUpdate: () => null,
  commitUpdate: (instance: HostNode, _type: string, _previous: unknown, next: Record<string, unknown>) => { instance.props = next; },
  commitTextUpdate: (instance: HostNode, _previous: string, next: string) => { instance.text = next; },
  createTextInstance: (text: string): HostNode => ({ type: "#text", props: {}, children: [], text }),
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

export function createReactMountHarness() {
  const container: HostContainer = { children: [] };
  const root = reconciler.createContainer(container, 0, null, false, null, "", console.error, console.error, console.error, null);

  return {
    render(children: ReactNode) {
      reconciler.updateContainer(children, root, null);
      return new Promise<void>(resolve => setTimeout(resolve, 20));
    },
    unmount() {
      reconciler.updateContainer(null, root, null);
      return new Promise<void>(resolve => setTimeout(resolve, 20));
    },
  };
}
