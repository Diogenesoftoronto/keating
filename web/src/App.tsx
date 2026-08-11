import { useEffect, useState } from "react";
import { z } from "zod";
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
const Tutorial = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/Tutorial")),
  "Tutorial",
);
const AtprotoBlog = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/AtprotoBlog")),
  "AtprotoBlog",
);
const AtprotoBlogPost = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/AtprotoBlog")),
  "AtprotoBlogPost",
);
const Chat = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/Chat")),
  "Chat",
);
const RenderingSmoke = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/RenderingSmoke")),
  "RenderingSmoke",
);
const Paper = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/Paper")),
  "Paper",
);
const Live = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/Live")),
  "Live",
);
const SharedSession = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/SharedSession")),
  "SharedSession",
);
const Usage = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/Usage")),
  "Usage",
);
const ComingUp = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/ComingUp")),
  "ComingUp",
);
const EvolutionDetail = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/EvolutionDetail")),
  "EvolutionDetail",
);
const KeatingBench = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/KeatingBench")),
  "KeatingBench",
);
const OAuthCallback = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/OAuthCallback")),
  "OAuthCallback",
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
const Pricing = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/Pricing")),
  "Pricing",
);
const LatestCommitReview = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/LatestCommitReview")),
  "LatestCommitReview",
);
const Courses = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/Courses")),
  "Courses",
);
const CourseWorkspace = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/CourseWorkspace")),
  "CourseWorkspace",
);
const CourseJoin = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/CourseJoin")),
  "CourseJoin",
);
import {
  applyKeatingUiTypography,
  loadKeatingUiSettings,
  subscribeKeatingUiSettings,
} from "./keating/ui-settings";
import { loadRouteChunk } from "./lib/stale-build-recovery";
import { css } from "../styled-system/css";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Landing,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  validateSearch: (search) =>
    z
      .object({
        settings: z.string().max(128).optional(),
        session: z.string().min(1).max(256).optional(),
        course: z
          .string()
          .min(2)
          .max(96)
          .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
          .optional(),
        courseMode: z.enum(["create", "edit"]).optional(),
        /** A request handed over from a course workspace; lands in the composer. */
        ask: z.string().max(2_000).optional(),
      })
      .passthrough()
      .parse(search),
  component: Chat,
});

const renderingSmokeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rendering-smoke",
  component: RenderingSmoke,
});

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/live",
  component: Live,
});

const usageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/usage",
  component: Usage,
});

const comingUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/coming-up",
  component: ComingUp,
});

const evolutionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/usage/evolution/$evolutionId",
  component: EvolutionDetail,
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
  component: AtprotoBlog,
});

const blogPostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/blog/$slug",
  component: AtprotoBlogPost,
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

const pricingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pricing",
  component: Pricing,
});

const latestCommitReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review/latest-commit",
  component: LatestCommitReview,
});

const coursesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/courses",
  component: Courses,
});

const courseJoinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/courses/join/$token",
  component: CourseJoin,
});

const courseWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/courses/$courseId",
  component: CourseWorkspace,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  renderingSmokeRoute,
  liveRoute,
  usageRoute,
  comingUpRoute,
  evolutionDetailRoute,
  benchRoute,
  sharedSessionRoute,
  tutorialRoute,
  blogRoute,
  blogPostRoute,
  paperRoute,
  oauthCallbackRoute,
  downloadRoute,
  termsRoute,
  privacyRoute,
  pricingRoute,
  latestCommitReviewRoute,
  coursesRoute,
  courseJoinRoute,
  courseWorkspaceRoute,
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
        className={css({
          animation: "spin 1s linear infinite",
        })}
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
