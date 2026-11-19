import { afterAll, beforeAll } from "bun:test";

/**
 * For test files that render components the way the server does (no browser globals). Every test file runs in
 * one process, and many install a partial `window` or `document` for their own cases; one left behind makes
 * `typeof window !== "undefined"` branches run against an object with no `localStorage` or `location`.
 * Call this at the top of the file: it hides those globals while the file runs and puts them back afterwards.
 */
export function renderAsServer(names: readonly string[] = ["window", "document"]) {
  const saved = new Map<string, PropertyDescriptor>();
  beforeAll(() => {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
      if (!descriptor) continue;
      saved.set(name, descriptor);
      delete (globalThis as Record<string, unknown>)[name];
    }
  });
  afterAll(() => {
    for (const [name, descriptor] of saved) Object.defineProperty(globalThis, name, descriptor);
    saved.clear();
  });
}
