import {
  RouterProvider,
  createRouter,
  createRoute,
  createRootRoute,
  createBrowserHistory,
  Outlet,
} from "@tanstack/react-router";
import { Landing } from "./pages/Landing";
import { Tutorial } from "./pages/Tutorial";
import { Blog } from "./pages/Blog";
import { Chat } from "./pages/Chat";
import { Paper } from "./pages/Paper";
import { SharedSession } from "./pages/SharedSession";
import { Usage } from "./pages/Usage";
import { OAuthCallback } from "./pages/OAuthCallback";

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

const usageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/usage",
  component: Usage,
});

const sharedSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$shareId",
  component: SharedSession,
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

const paperRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/paper",
  component: Paper,
});

const oauthCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/oauth/callback",
  component: OAuthCallback,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  usageRoute,
  sharedSessionRoute,
  tutorialRoute,
  blogRoute,
  paperRoute,
  oauthCallbackRoute,
]);

const browserHistory = createBrowserHistory();
const router = createRouter({ routeTree, history: browserHistory });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return <RouterProvider router={router} />;
}
