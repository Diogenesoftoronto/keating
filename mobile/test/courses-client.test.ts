import { afterEach, beforeEach, expect, test } from "bun:test";
import { mergeCookies, parseSetCookie, serializeCookies } from "../src/lib/courses/cookie-jar";
import {
  clearCourseSession,
  courseMaterialDownloadRequest,
  CourseApiError,
  fetchCourse,
  fetchCoursesForCurrentAccount,
  fetchCourseSession,
  joinCourse,
} from "../src/lib/courses/client";
import {
  courseAccountCredentialKey,
  setCourseCredentialStoreForTests,
  type CourseCredentialStore,
} from "../src/lib/courses/credentials";
import { allCourseLessons, normalizeCourseListItem, normalizeCourseSnapshot } from "../src/lib/courses/types";

function createCredentialStore(): CourseCredentialStore & { values: Map<string, string>; calls: string[] } {
  const values = new Map<string, string>();
  const calls: string[] = [];
  return {
    values,
    calls,
    async getItem(key) {
      calls.push(`get:${key}`);
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      calls.push(`set:${key}:${value}`);
      values.set(key, value);
    },
    async deleteItem(key) {
      calls.push(`delete:${key}`);
      values.delete(key);
    },
  };
}

let credentials: ReturnType<typeof createCredentialStore>;

beforeEach(async () => {
  credentials = createCredentialStore();
  setCourseCredentialStoreForTests(credentials);
  await clearCourseSession();
  credentials.calls.length = 0;
});

afterEach(async () => {
  await clearCourseSession();
  setCourseCredentialStoreForTests(null);
});

test("set-cookie parsing keeps the pair and drops the attributes", () => {
  expect(parseSetCookie(null)).toEqual({});
  expect(parseSetCookie("keating_course_account=abc123; Path=/; HttpOnly; Max-Age=31536000"))
    .toEqual({ keating_course_account: "abc123" });
});

test("comma-joined cookie headers split on cookies, not on expiry dates", () => {
  // React Native folds multiple Set-Cookie headers into one comma-joined
  // string, and RFC dates contain their own comma.
  const header = "a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/, b=2; Path=/";
  expect(parseSetCookie(header)).toEqual({ a: "1", b: "2" });
});

test("the jar merges updates and forgets cleared cookies", () => {
  const jar = mergeCookies({}, { session: "one", extra: "keep" });
  expect(serializeCookies(jar)).toBe("session=one; extra=keep");
  const rotated = mergeCookies(jar, { session: "two" });
  expect(rotated.session).toBe("two");
  const cleared = mergeCookies(rotated, { session: "" });
  expect(cleared.session).toBeUndefined();
  expect(serializeCookies({})).toBeNull();
});

test("course payloads survive missing and malformed fields", () => {
  expect(normalizeCourseListItem(null)).toEqual({
    id: "",
    title: "Untitled course",
    description: "",
    role: "student",
    memberCount: 0,
    lessonCount: 0,
    completedLessons: 0,
    updatedAt: "",
  });
  // An unknown role must not become a privileged one.
  expect(normalizeCourseListItem({ role: "administrator" }).role).toBe("student");
});

test("a course snapshot normalizes into modules, lessons, and permissions", () => {
  const snapshot = normalizeCourseSnapshot({
    course: {
      id: "course_1",
      title: "Intro to Logic",
      modules: [
        { id: "m1", title: "Foundations", lessons: [{ id: "l1", title: "Validity" }, { id: "l2" }] },
        { id: "m2", lessons: [] },
      ],
      materials: [{ id: "mat1", kind: "wormhole", title: "Reader" }],
      members: [{ accountId: "a1", displayName: "Ada", role: "owner" }],
    },
    viewer: { accountId: "a1", role: "owner" },
    permissions: { canEditCourse: true },
  });

  expect(snapshot.course.title).toBe("Intro to Logic");
  expect(allCourseLessons(snapshot.course).map((lesson) => lesson.id)).toEqual(["l1", "l2"]);
  expect(snapshot.course.modules[1]!.title).toBe("Untitled module");
  // An unrecognised material kind falls back rather than breaking the render.
  expect(snapshot.course.materials[0]!.kind).toBe("note");
  expect(snapshot.permissions.canEditCourse).toBe(true);
  // Permissions the server did not grant stay false rather than undefined.
  expect(snapshot.permissions.canInvite).toBe(false);
  expect(snapshot.viewer.teacherAccess).toBe("private");
});

test("bootstraps exactly one server account before listing courses and stores only its scoped credential", async () => {
  const requests: Array<{ url: string; cookie: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, cookie: new Headers(init?.headers).get("Cookie") });
    if (url.endsWith("/session")) {
      return new Response(JSON.stringify({
        account: { id: "local_account", displayName: "Local learner", mode: "local" },
      }), {
        headers: {
          "content-type": "application/json",
          "set-cookie": "other_session=never-store; Path=/, keating_course_account=stable_123; Path=/; HttpOnly",
        },
      });
    }
    return new Response(JSON.stringify({ courses: [] }), { headers: { "content-type": "application/json" } });
  };

  const result = await fetchCoursesForCurrentAccount({ fetchImpl });

  expect(result.account.id).toBe("local_account");
  expect(requests.map((request) => request.url.endsWith("/session") ? "session" : "courses"))
    .toEqual(["session", "courses"]);
  expect(requests[0]!.cookie).toBeNull();
  expect(requests[1]!.cookie).toBe("keating_course_account=stable_123");
  expect(credentials.values).toEqual(new Map([[courseAccountCredentialKey(), "stable_123"]]));
  expect(credentials.calls).toContain(`set:${courseAccountCredentialKey()}:stable_123`);
});

test("rejects malformed successful responses instead of fabricating a course record", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    course: { title: "Missing ID" },
    viewer: { displayName: "Ada" },
  }), { headers: { "content-type": "application/json" } });

  await expect(fetchCourse("course_1", { fetchImpl })).rejects.toMatchObject({
    name: "CourseApiError",
    code: "course_invalid_response",
  } satisfies Partial<CourseApiError>);
});

test("join requests respect caller cancellation and do not turn it into a retryable network error", async () => {
  const controller = new AbortController();
  let observedAbort = false;
  const fetchImpl: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const abort = () => {
      observedAbort = true;
      reject(new DOMException("Cancelled", "AbortError"));
    };
    if (init?.signal?.aborted) abort();
    else init?.signal?.addEventListener("abort", abort, { once: true });
  });

  const joining = joinCourse("invite_123", false, { fetchImpl, signal: controller.signal, timeoutMs: 1_000 });
  controller.abort();

  await expect(joining).rejects.toMatchObject({ name: "AbortError" });
  expect(observedAbort).toBe(true);
});

test("a timed-out join is recoverable and exposes its timeout code", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), { once: true });
  });

  await expect(joinCourse("invite_123", false, { fetchImpl, timeoutMs: 1 })).rejects.toMatchObject({
    name: "CourseApiError",
    code: "course_timeout",
  } satisfies Partial<CourseApiError>);
});

test("disconnect drops the scoped credential so the next session starts without the old account", async () => {
  let requestNumber = 0;
  const cookies: Array<string | null> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestNumber += 1;
    cookies.push(new Headers(init?.headers).get("Cookie"));
    return new Response(JSON.stringify({
      account: { id: requestNumber === 1 ? "old" : "new", displayName: "Learner", mode: "local" },
    }), {
      headers: {
        "content-type": "application/json",
        "set-cookie": `keating_course_account=${requestNumber === 1 ? "old_cookie" : "new_cookie"}; Path=/; HttpOnly`,
      },
    });
  };

  expect((await fetchCourseSession({ fetchImpl })).id).toBe("old");
  await clearCourseSession();
  expect((await fetchCourseSession({ fetchImpl })).id).toBe("new");

  expect(cookies).toEqual([null, null]);
  expect(credentials.values).toEqual(new Map([[courseAccountCredentialKey(), "new_cookie"]]));
  expect(credentials.calls).toContain(`delete:${courseAccountCredentialKey()}`);
});

test("protected material requests keep the native credential inside the app", async () => {
  await fetchCourseSession({
    fetchImpl: async () => new Response(JSON.stringify({
      account: { id: "learner", displayName: "Learner", mode: "local" },
    }), {
      headers: { "set-cookie": "keating_course_account=material_cookie; Path=/; HttpOnly" },
    }),
  });

  const request = await courseMaterialDownloadRequest("course/one", "material two");
  expect(request.url).toEndWith("/api/courses/course%2Fone/materials/material%20two");
  expect(request.headers.Cookie).toBe("keating_course_account=material_cookie");
});
