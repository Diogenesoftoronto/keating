export const WEBSITE_ORIGIN = "https://keating.help";
export const APP_ORIGIN = "https://chat.keating.help";

const PUBLIC_PATHS = new Set(["/", "/download", "/pricing", "/paper", "/terms", "/privacy"]);
const APP_PATHS = new Set(["/chat", "/usage", "/bench", "/courses", "/coming-up", "/live", "/training-data", "/review", "/s", "/l", "/join"]);

export function isApplicationPath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0];
  return APP_PATHS.has(pathname) || [...APP_PATHS].some(base => pathname.startsWith(`${base}/`));
}

/** Resolve only first-party relative destinations; local development stays local. */
export function hostedNavigationHref(path: string, hostname: string, appOnly: boolean): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const pathname = path.split(/[?#]/, 1)[0];
  const suffix = path.slice(pathname.length);
  if (hostname === "keating.help" && isApplicationPath(path)) {
    return `${APP_ORIGIN}${pathname === "/chat" ? "/" : pathname}${suffix}`;
  }
  if (appOnly || hostname === "chat.keating.help") {
    if (pathname === "/chat") return `/${suffix}`;
    if (pathname !== "/" && PUBLIC_PATHS.has(pathname)) return `${WEBSITE_ORIGIN}${path}`;
  }
  return path;
}

export function applicationRootHref(hostname: string, appOnly: boolean): string {
  return hostname === "keating.help" ? `${APP_ORIGIN}/` : appOnly || hostname === "chat.keating.help" ? "/" : "/chat";
}
