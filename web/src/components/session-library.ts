import type { SessionMetadata } from "../types/session";
import {
  categorize,
  type ArtifactHero,
  type CategoryKey,
  type CategoryMeta,
} from "./session-card-visuals";
import { flattenSessionTree, type SessionTreeNode } from "./session-tree";

export type SessionActivityFilter = "all" | "forks" | ArtifactHero["type"];

export const SESSION_ACTIVITY_LABELS: Record<SessionActivityFilter, string> = {
  all: "All activities",
  forks: "Forks",
  map: "Concept maps",
  animation: "Animations",
  plan: "Lesson plans",
};

export function sessionCategories(
  items: SessionMetadata[],
): Array<CategoryMeta & { count: number }> {
  const categories = new Map<CategoryKey, CategoryMeta & { count: number }>();
  for (const session of items) {
    const category = categorize(session.title);
    const existing = categories.get(category.key);
    categories.set(category.key, {
      ...category,
      count: (existing?.count ?? 0) + 1,
    });
  }
  return [...categories.values()].sort(
    (left, right) =>
      right.count - left.count || left.label.localeCompare(right.label),
  );
}

/** Prune unrelated branches while keeping every matching session's ancestry. */
export function filterSessionLibrary({
  roots,
  heroes,
  queryResults,
  category = "all",
  activity = "all",
}: {
  roots: SessionTreeNode[];
  heroes: ReadonlyMap<string, ArtifactHero>;
  queryResults: SessionMetadata[] | null;
  category?: CategoryKey | "all";
  activity?: SessionActivityFilter;
}): { roots: SessionTreeNode[]; matches: ReadonlySet<string> } {
  if (queryResults === null && category === "all" && activity === "all") {
    return { roots, matches: new Set(flattenSessionTree(roots).map(({ session }) => session.id)) };
  }
  const queryIds = queryResults
    ? new Set(queryResults.map((session) => session.id))
    : null;
  const matches = new Set<string>();
  for (const { session } of flattenSessionTree(roots)) {
    if (queryIds && !queryIds.has(session.id)) continue;
    if (category !== "all" && categorize(session.title).key !== category)
      continue;
    if (activity === "forks" && !session.parentSessionId) continue;
    const hero = heroes.get(session.id);
    if (
      activity !== "all" &&
      activity !== "forks" &&
      !(hero?.types ?? (hero ? [hero.type] : [])).includes(activity)
    )
      continue;
    matches.add(session.id);
  }
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
