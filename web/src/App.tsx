import { useEffect, useState } from "react";
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
import { KeatingBench } from "./pages/KeatingBench";
import { OAuthCallback } from "./pages/OAuthCallback";
import { DioSuccess } from "./pages/DioSuccess";
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

const browserHistory = createBrowserHistory();
const router = createRouter({ routeTree, history: browserHistory });

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
