import { useEffect, useState } from "react";
import {
  RouterProvider,
  createRouter,
  createRoute,
  createRootRoute,
  createBrowserHistory,
  lazyRouteComponent,
  Outlet,
} from "@tanstack/react-router";
// Landing is the entry page — keep it eager so first paint needs no extra
// round-trip. (Its heavy 3D hero is already lazy-loaded inside the page.)
import { Landing } from "./pages/Landing";
// Every other route is code-split into its own chunk, fetched on navigation, so
// the entry bundle no longer ships Chat, the assistant panel, markdown/KaTeX, etc.
const Tutorial = lazyRouteComponent(() => import("./pages/Tutorial"), "Tutorial");
const Blog = lazyRouteComponent(() => import("./pages/Blog"), "Blog");
const Chat = lazyRouteComponent(() => import("./pages/Chat"), "Chat");
const Paper = lazyRouteComponent(() => import("./pages/Paper"), "Paper");
const SharedSession = lazyRouteComponent(
  () => import("./pages/SharedSession"),
  "SharedSession",
);
const Usage = lazyRouteComponent(() => import("./pages/Usage"), "Usage");
const KeatingBench = lazyRouteComponent(
  () => import("./pages/KeatingBench"),
  "KeatingBench",
);
const OAuthCallback = lazyRouteComponent(
  () => import("./pages/OAuthCallback"),
  "OAuthCallback",
);
const DioSuccess = lazyRouteComponent(
  () => import("./pages/DioSuccess"),
  "DioSuccess",
);
import {
  applyKeatingUiTypography,
  loadKeatingUiSettings,
  subscribeKeatingUiSettings,
} from "./keating/ui-settings";

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

const benchRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/bench",
	component: KeatingBench,
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

const dioSuccessRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dio/success",
	component: DioSuccess,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	chatRoute,
	usageRoute,
	benchRoute,
	sharedSessionRoute,
  tutorialRoute,
  blogRoute,
  paperRoute,
  oauthCallbackRoute,
	dioSuccessRoute,
]);

// Shown while a lazily-loaded route chunk is in flight (after defaultPendingMs)
// so navigation doesn't flash a blank screen.
function RoutePending() {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "60vh",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="animate-spin"
        aria-label="Loading"
        style={{
          width: 28,
          height: 28,
          borderRadius: "9999px",
          border: "3px solid rgba(0,0,0,0.15)",
          borderTopColor: "rgba(0,0,0,0.55)",
        }}
      />
    </div>
  );
}

const browserHistory = createBrowserHistory();
const router = createRouter({
  routeTree,
  history: browserHistory,
  defaultPendingComponent: RoutePending,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function KeatingUiPreferencesSync() {
  const [settings, setSettings] = useState(() => loadKeatingUiSettings());

  useEffect(() => {
    applyKeatingUiTypography(settings.fontFamily);
  }, [settings.fontFamily]);

  useEffect(() => subscribeKeatingUiSettings(setSettings), []);

  return null;
}

export function App() {
  return (
    <>
      <KeatingUiPreferencesSync />
      <RouterProvider router={router} />
    </>
  );
}
