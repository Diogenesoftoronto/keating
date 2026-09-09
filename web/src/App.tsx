import { useEffect, useState } from "react";
import { z } from "zod";
import {
  RouterProvider,
  useRouter,
  type ErrorComponentProps,
  createRouter,
  createRoute,
  createRootRoute,
  createBrowserHistory,
  lazyRouteComponent,
  Outlet,
  redirect,
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
const NotOrganicCallback = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/NotOrganicCallback")),
  "NotOrganicCallback",
);
const LatestCommitReview = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/LatestCommitReview")),
  "LatestCommitReview",
);
const TrajectoryReviewIndex = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/TrajectoryReviewIndex")),
  "TrajectoryReviewIndex",
);
const TrajectoryReview = lazyRouteComponent(
  () => loadRouteChunk(() => import("./pages/TrajectoryReview")),
  "TrajectoryReview",
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
import { desktopMarketingUrl, isDesktopShell } from "./lib/desktop-navigation";
import { AppStatusScreen, RouteLoadingScreen, RouteNotFoundScreen } from "./components/AppStatusScreen";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  beforeLoad: ({ location, preload }) => {
    if (!isDesktopShell()) return;
    const websiteUrl = desktopMarketingUrl(location.href);
    if (!websiteUrl) return;
    if (!preload && location.pathname !== "/") {
      window.open(websiteUrl, "_blank", "noopener,noreferrer");
    }
    throw redirect({ to: "/chat", replace: true });
  },
});

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

const trainingDataRoute = createRoute({ getParentRoute: () => rootRoute, path: "/training-data", component: lazyRouteComponent(() => loadRouteChunk(() => import("./pages/TrainingData")), "TrainingData") });

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

const notOrganicCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notorganic/callback",
  component: NotOrganicCallback,
});

const latestCommitReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review/latest-commit",
  component: LatestCommitReview,
});

const trajectoryReviewIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: TrajectoryReviewIndex,
});

const trajectoryReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review/sessions/$sessionId",
  component: TrajectoryReview,
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
  ...(import.meta.env.DEV ? [renderingSmokeRoute] : []),
  liveRoute,
  usageRoute,
  trainingDataRoute,
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
  notOrganicCallbackRoute,
  latestCommitReviewRoute,
  trajectoryReviewIndexRoute,
  trajectoryReviewRoute,
  coursesRoute,
  courseJoinRoute,
  courseWorkspaceRoute,
]);

// Shown while a lazily-loaded route chunk is in flight (after defaultPendingMs)
// so navigation doesn't flash a blank screen.
function RouteFailure({ error, reset }: ErrorComponentProps) {
  const currentRouter = useRouter();
  const statusCode = Number((error as { status?: number; statusCode?: number }).status
    ?? (error as { statusCode?: number }).statusCode);
  const status = typeof navigator !== "undefined" && !navigator.onLine ? "offline"
    : statusCode === 403 ? "403" : statusCode === 404 ? "404" : "500";
  return <AppStatusScreen status={status} onRetry={() => {
    reset();
    void currentRouter.invalidate();
  }} />;
}

const browserHistory = createBrowserHistory();
const router = createRouter({
  routeTree,
  history: browserHistory,
  defaultPendingComponent: RouteLoadingScreen,
  defaultNotFoundComponent: () => <RouteNotFoundScreen />,
  defaultErrorComponent: RouteFailure,
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
  useEffect(() => {
    if (!window.keatingDesktop) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void import("./keating/oauth").then(({ subscribeDesktopOAuthCallback, OAUTH_MESSAGE_CHANNEL }) => {
      if (disposed) return;
      // Keep receiving browser approvals when settings is closed or routes change.
      unsubscribe = subscribeDesktopOAuthCallback(result => {
        window.dispatchEvent(new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: OAUTH_MESSAGE_CHANNEL, ...result },
        }));
      });
    });
    return () => { disposed = true; unsubscribe?.(); };
  }, []);
  return (
    <>
      <KeatingUiPreferencesSync />
      <RouterProvider router={router} />
    </>
  );
}
