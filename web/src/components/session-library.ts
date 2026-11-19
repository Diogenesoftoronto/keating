import type { SessionMetadata } from "../types/session";
import { flattenSessionTree, type SessionTreeNode } from "./session-tree";

/** Prune unrelated branches while keeping every matching session's ancestry. */
export function filterSessionLibrary({
  roots,
  queryResults,
}: {
  roots: SessionTreeNode[];
  queryResults: SessionMetadata[] | null;
}): { roots: SessionTreeNode[]; matches: ReadonlySet<string> } {
  if (queryResults === null) {
    return { roots, matches: new Set(flattenSessionTree(roots).map(({ session }) => session.id)) };
  }
  const matches = new Set(queryResults.map((session) => session.id));
  const prune = (node: SessionTreeNode): SessionTreeNode | null => {
    const children = node.children
      .map(prune)
      .filter((child): child is SessionTreeNode => child !== null);
    return matches.has(node.session.id) || children.length
      ? { ...node, children }
      : null;
  };
  return {
    roots: roots
      .map(prune)
      .filter((node): node is SessionTreeNode => node !== null),
    matches,
  };
}
