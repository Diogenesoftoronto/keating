/**
 * Test helper: render a component that contains TanStack `<Link>`s by mounting
 * it inside a memory router, then return the server markup.
 */
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

export async function renderWithRouter(element: ReactElement): Promise<string> {
  const root = createRootRoute({ component: () => element });
  const index = createRoute({ getParentRoute: () => root, path: "/" });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: true,
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}
