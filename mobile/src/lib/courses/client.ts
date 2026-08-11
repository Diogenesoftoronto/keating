import { KEATING_WEB_ORIGIN } from "../product-links";
import { parseSetCookie } from "./cookie-jar";
import {
  COURSE_ACCOUNT_COOKIE_NAME,
  courseAccountCredentialKey,
  getCourseCredentialStore,
} from "./credentials";
import {
  type CourseListItem,
  type CourseSessionAccount,
  type CourseViewerSnapshot,
  normalizeCourseListItem,
  normalizeCourseSnapshot,
} from "./types";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const COOKIE_VALUE_PATTERN = /^[A-Za-z0-9._~-]{1,512}$/;

/** A course request that failed with the server's own error code attached. */
export class CourseApiError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
    this.name = "CourseApiError";
  }

  /** True when the learner is not a member, or the invite did not apply. */
  get isAccessProblem(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 404;
  }
}

let courseCredential: string | null | undefined;

function isCourseAccountCredential(value: unknown): value is string {
  return typeof value === "string" && COOKIE_VALUE_PATTERN.test(value);
}

async function loadCourseCredential(): Promise<string | null> {
  if (courseCredential !== undefined) return courseCredential;
  try {
    const raw = await getCourseCredentialStore().getItem(courseAccountCredentialKey());
    courseCredential = isCourseAccountCredential(raw) ? raw : null;
  } catch {
    courseCredential = null;
  }
  return courseCredential;
}

async function rememberCookies(header: string | null): Promise<void> {
  const credential = parseSetCookie(header)[COURSE_ACCOUNT_COOKIE_NAME];
  if (credential === undefined) return;
  if (!isCourseAccountCredential(credential)) {
    courseCredential = null;
    await getCourseCredentialStore().deleteItem(courseAccountCredentialKey()).catch(() => undefined);
    return;
  }
  courseCredential = credential;
  await getCourseCredentialStore().setItem(courseAccountCredentialKey(), credential).catch(() => undefined);
}

/** Drops the stored session; the next request starts a fresh course account. */
export async function clearCourseSession(): Promise<void> {
  courseCredential = null;
  await getCourseCredentialStore().deleteItem(courseAccountCredentialKey()).catch(() => undefined);
}

export interface CourseRequestOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function request<T>(
  path: string,
  init: RequestInit,
  normalize: (payload: unknown) => T,
  options: CourseRequestOptions = {},
): Promise<T> {
  const { signal: upstreamSignal, fetchImpl = fetch, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = options;
  const credential = await loadCourseCredential();
  const controller = new AbortController();
  let timedOut = false;
  const abortForUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", abortForUpstream, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(credential ? { Cookie: `${COURSE_ACCOUNT_COOKIE_NAME}=${credential}` } : {}),
  };

  try {
    const response = await fetchImpl(`${KEATING_WEB_ORIGIN}/api/courses${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    await rememberCookies(response.headers.get("set-cookie"));

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const body = (payload ?? {}) as Record<string, unknown>;
      const data = (body.data ?? {}) as Record<string, unknown>;
      const message = typeof body.statusMessage === "string" && body.statusMessage
        ? body.statusMessage
        : typeof body.message === "string" && body.message
          ? body.message
          : `The course server returned HTTP ${response.status}.`;
      throw new CourseApiError(
        response.status,
        message,
        typeof data.code === "string" ? data.code : "course_request_failed",
      );
    }

    return normalize(payload);
  } catch (error) {
    if (error instanceof CourseApiError) throw error;
    if (timedOut) {
      throw new CourseApiError(0, "The course server took too long to respond. Please try again.", "course_timeout");
    }
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new CourseApiError(0, "Could not reach Keating. Check your connection.", "course_offline");
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortForUpstream);
  }
}

export function fetchCourseSession(options?: CourseRequestOptions): Promise<CourseSessionAccount> {
  return request("/session", { method: "GET" }, (payload) => {
    const root = asRecord(payload);
    const account = asRecord(root.account);
    const mode = account.mode;
    if (!isNonEmptyString(account.id) || !isNonEmptyString(account.displayName)
      || (mode !== "local" && mode !== "hosted" && mode !== "development")) {
      throw invalidSuccess("The course server returned an incomplete session.");
    }
    return {
      id: account.id,
      displayName: account.displayName,
      mode,
    };
  }, options);
}

export function fetchCourses(options?: CourseRequestOptions): Promise<CourseListItem[]> {
  return request("", { method: "GET" }, (payload) => {
    const courses = asRecord(payload).courses;
    if (!Array.isArray(courses) || courses.some((course) => !isNonEmptyString(asRecord(course).id))) {
      throw invalidSuccess("The course server returned an incomplete course list.");
    }
    return courses.map(normalizeCourseListItem);
  }, options);
}

/**
 * Establishes the server-owned course account before listing courses. Do not
 * parallelize these requests: a fresh local session is created by /session.
 */
export async function fetchCoursesForCurrentAccount(
  options?: CourseRequestOptions,
): Promise<{ account: CourseSessionAccount; courses: CourseListItem[] }> {
  const account = await fetchCourseSession(options);
  const courses = await fetchCourses(options);
  return { account, courses };
}

export function fetchCourse(courseId: string, options?: CourseRequestOptions): Promise<CourseViewerSnapshot> {
  return request(`/${encodeURIComponent(courseId)}`, { method: "GET" }, normalizeSnapshot, options);
}

/**
 * Redeems an invite code. `acceptTeacherAccess` is the learner's explicit
 * consent to let course teachers see their work, so it is always passed
 * through from a deliberate choice rather than defaulted on.
 */
export function joinCourse(
  inviteCode: string,
  acceptTeacherAccess: boolean,
  options?: CourseRequestOptions,
): Promise<CourseViewerSnapshot> {
  return request(
    `/join/${encodeURIComponent(inviteCode)}`,
    { method: "POST", body: JSON.stringify({ acceptTeacherAccess }) },
    normalizeSnapshot,
    options,
  );
}

/** Authenticated native download request for a protected course material. */
export async function courseMaterialDownloadRequest(
  courseId: string,
  materialId: string,
): Promise<{ url: string; headers: Record<string, string> }> {
  const credential = await loadCourseCredential();
  if (!credential) {
    throw new CourseApiError(401, "Reconnect Courses before opening this material.", "course_session_missing");
  }
  return {
    url: `${KEATING_WEB_ORIGIN}/api/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}`,
    headers: { Cookie: `${COURSE_ACCOUNT_COOKIE_NAME}=${credential}` },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidSuccess(message: string): CourseApiError {
  return new CourseApiError(200, message, "course_invalid_response");
}

function normalizeSnapshot(payload: unknown): CourseViewerSnapshot {
  const root = asRecord(payload);
  const course = asRecord(root.course);
  const viewer = asRecord(root.viewer);
  if (!isNonEmptyString(course.id) || !isNonEmptyString(viewer.accountId)) {
    throw invalidSuccess("The course server returned an incomplete course.");
  }
  return normalizeCourseSnapshot(payload);
}
