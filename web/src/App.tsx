import { useEffect, useState } from "react";
import { usePostHog } from "@posthog/react";
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
const Tutorial = lazyRouteComponent(() => loadRouteChunk(() => import("./pages/Tutorial")), "Tutorial");
const Blog = lazyRouteComponent(() => loadRouteChunk(() => import("./pages/Blog")), "Blog");
const Chat = lazyRouteComponent(() => loadRouteChunk(() => import("./pages/Chat")), "Chat");
const Paper = lazyRouteComponent(() => loadRouteChunk(() => import("./pages/Paper")), "Paper");
const SharedSession = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/SharedSession")),
  "SharedSession",
);
const Usage = lazyRouteComponent(() => loadRouteChunk(() => import("./pages/Usage")), "Usage");
const KeatingBench = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/KeatingBench")),
  "KeatingBench",
);
const OAuthCallback = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/OAuthCallback")),
  "OAuthCallback",
);
const DioSuccess = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/DioSuccess")),
  "DioSuccess",
);
const Download = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/Download")),
  "Download",
);
const Terms = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/Terms")),
  "Terms",
);
const Privacy = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/Privacy")),
  "Privacy",
);
import {
  applyKeatingUiTypography,
  loadKeatingUiSettings,
  subscribeKeatingUiSettings,
} from "./keating/ui-settings";
import { getStoredDioIdentity } from "./dio-provider";
import { loadRouteChunk } from "./lib/stale-build-recovery";

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

const downloadRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/download",
	component: Download,
});

const termsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/terms",
	component: Terms,
});

const privacyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/privacy",
	component: Privacy,
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
	downloadRoute,
	termsRoute,
	privacyRoute,
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

function PostHogIdentitySync() {
  const posthog = usePostHog();

  useEffect(() => {
    let cancelled = false;
    getStoredDioIdentity()
      .then((identity) => {
        if (cancelled || !identity) return;
        posthog.identify(identity.email, { email: identity.email, dio_access: true });
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.warn("Failed to sync Dio analytics identity:", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [posthog]);

  return null;
}

export function App() {
  return (
    <>
      <KeatingUiPreferencesSync />
      <PostHogIdentitySync />
      <RouterProvider router={router} />
    </>
  );
}
