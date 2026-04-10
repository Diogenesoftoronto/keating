import {
  RouterProvider,
  createRouter,
  createRoute,
  createRootRoute,
  createHashHistory,
  Outlet,
} from "@tanstack/react-router";
import { Landing } from "./pages/Landing";
import { Tutorial } from "./pages/Tutorial";
import { Blog } from "./pages/Blog";
import { Chat } from "./pages/Chat";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Landing,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: Chat,
});

const tutorialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tutorial",
  component: Tutorial,
});

const blogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/blog",
  component: Blog,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  tutorialRoute,
  blogRoute,
]);

const hashHistory = createHashHistory();
const router = createRouter({ routeTree, history: hashHistory });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return <RouterProvider router={router} />;
}
