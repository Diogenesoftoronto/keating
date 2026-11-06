import { describe, expect, test } from "bun:test";
import { H3Event } from "h3";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { CourseAccountSessions, assertCourseBridgeOrigin, verifyCourseAccount } from "../../server/utils/course-account-session";
import { adoptCourseIdentity, adoptLocalCourses } from "../../server/utils/course-repository";
import { courseSchema } from "../courses/contracts";
import { projectCourseForViewer } from "../courses/operations";
import { CourseAccountBridge } from "../courses/account-session";
import { requireCourseProductSession } from "../../server/utils/course-session";
import courseApi from "../../server/api/courses/[...path]";
import uploadAttachment from "../../server/api/submission-attachments/index.post";
import { createCourse } from "../../server/utils/course-repository";
import { localCourseAccountIdFromSecret } from "../../server/utils/course-session";
import { ownsAttachmentAccount } from "../../server/utils/submission-attachments";

const from = `local_${"a".repeat(64)}`;
const did = "did:plc:learner";
const now = new Date().toISOString();
function course() {
  return courseSchema.parse({ id: "course_one", schemaVersion: 1, title: "Account course", ownerAccountId: from,
    createdAt: now, updatedAt: now, revision: 0,
    members: [{ accountId: from, displayName: "Learner", role: "owner", joinedAt: now, teacherAccess: "full", progress: { completedLessonIds: ["lesson_one"], lastActiveAt: now } }],
    submissions: [{ id: "submission_one", lessonId: "lesson_one", exerciseId: "exercise_one", accountId: from,
      answer: `Do not rewrite text mentioning ${from}`, version: 1, updatedAt: now }],
    settings: {},
  });
}
async function indexKey(accountId: string) {
  return `account:${Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountId))).toString("hex")}`;
}

describe("verified course identity", () => {
  test("real course routes adopt a local course and return it to a second verified device", async () => {
    const oldIssuer = process.env.NOTORGANIC_ISSUER;
    const oldFetch = globalThis.fetch;
    process.env.NOTORGANIC_ISSUER = "https://issuer.example";
    globalThis.fetch = (async () => Response.json({ account: { did } })) as unknown as typeof fetch;
    try {
      const secret = crypto.randomUUID().replaceAll("-", "");
      const source = await localCourseAccountIdFromSecret(secret);
      const created = await createCourse(source, "Learner", { title: "Device course" } as never);
      const link = (cookie?: string) => new H3Event(new Request("http://keating.example/api/courses/account-session", {
        method: "POST", headers: { "x-forwarded-proto": "https", origin: "https://keating.example", authorization: "DPoP access", dpop: "proof", ...(cookie ? { cookie } : {}) },
      }));
      const first = link(`keating_course_account=${secret}`);
      const firstResult = await courseApi(first) as { adoptedLocalAccountIds: string[] };
      expect(firstResult.adoptedLocalAccountIds).toContain(source);
      expect(await ownsAttachmentAccount(did, source)).toBe(true);
      expect(await ownsAttachmentAccount("did:plc:other", source)).toBe(false);
      const second = link();
      await courseApi(second);
      const token = second.res.headers.getSetCookie().find(value => value.startsWith("keating_course_session="))!.split(";", 1)[0]!;
      const listed = await courseApi(new H3Event(new Request("https://keating.example/api/courses", { headers: { cookie: token } }))) as { courses: Array<{ id: string }> };
      expect(listed.courses.some(value => value.id === created.course.id)).toBe(true);
      await expect(courseApi(new H3Event(new Request("https://keating.example/api/courses", {
        headers: { cookie: token, "x-keating-course-account": "did:plc:different" },
      })))).rejects.toMatchObject({ status: 401 });
      expect(first.res.headers.getSetCookie().join(";")).toContain("HttpOnly");
      expect(first.res.headers.getSetCookie().find(value => value.startsWith("keating_course_session="))).toContain("Secure");
      await courseApi(new H3Event(new Request("https://keating.example/api/courses/account-session", { method: "DELETE", headers: { cookie: token, origin: "https://keating.example" } })));
      await expect(courseApi(new H3Event(new Request("https://keating.example/api/courses", { headers: { cookie: token } })))).rejects.toMatchObject({ status: 401 });
    } finally {
      globalThis.fetch = oldFetch;
      if (oldIssuer === undefined) delete process.env.NOTORGANIC_ISSUER; else process.env.NOTORGANIC_ISSUER = oldIssuer;
    }
  });
  test("trusts provider DID only and forwards exact provider-target DPoP without redirects", async () => {
    const fetcher = (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://issuer.example/v1/account");
      expect(init.method).toBe("GET"); expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("dpop")).toBe("proof");
      return Response.json({ account: { did, id: "untrusted-other-id" } });
    }) as unknown as typeof fetch;
    expect(await verifyCourseAccount("DPoP opaque", "proof", "https://issuer.example", fetcher)).toBe(did);
    await expect(verifyCourseAccount("Bearer opaque", "proof", "https://issuer.example", fetcher)).rejects.toMatchObject({ status: 401 });
    await expect(verifyCourseAccount("DPoP opaque", "proof", "http://issuer.example", fetcher)).rejects.toMatchObject({ status: 503 });
    await expect(verifyCourseAccount("DPoP opaque", "proof", "https://issuer.example", (async () => Response.json({ account: { id: did } })) as unknown as typeof fetch)).rejects.toMatchObject({ status: 401 });
  });
  test("rejects cross-origin and missing-origin browser linking; native must be explicit", () => {
    const event = (headers: HeadersInit) => new H3Event(new Request("https://keating.example/api/courses/account-session", { method: "POST", headers }));
    expect(assertCourseBridgeOrigin(event({ origin: "https://keating.example" }))).toBe(false);
    expect(assertCourseBridgeOrigin(event({ "x-keating-client": "native" }))).toBe(true);
    expect(() => assertCourseBridgeOrigin(event({}))).toThrow();
    expect(() => assertCourseBridgeOrigin(event({ origin: "https://evil.example", "x-keating-client": "native" }))).toThrow();
  });
  test("accepts proxy HTTPS without trusting a forwarded host for browser linking or uploads", async () => {
    const event = (origin: string, extra: Record<string, string> = {}) => new H3Event(new Request("http://keating.example/api/courses/account-session", {
      method: "POST", headers: { origin, "x-forwarded-proto": "https", ...extra },
    }));
    expect(assertCourseBridgeOrigin(event("https://keating.example"))).toBe(false);
    expect(() => assertCourseBridgeOrigin(event("https://evil.example", { "x-forwarded-host": "evil.example" }))).toThrow();
    const upload = (origin: string) => new H3Event(new Request("http://keating.example/api/submission-attachments", {
      method: "POST", headers: { origin, "x-forwarded-proto": "https", cookie: `keating_course_session=${"f".repeat(64)}` },
    }));
    // A same-origin upload reaches account authentication; cross-origin stays forbidden.
    await expect(uploadAttachment(upload("https://keating.example"))).rejects.toMatchObject({ status: 401 });
    await expect(uploadAttachment(upload("https://evil.example"))).rejects.toMatchObject({ status: 403 });
  });
  test("expires server authority and rotates account changes while revoking the prior token", async () => {
    let clock = 1000;
    const sessions = new CourseAccountSessions(createStorage({ driver: memoryDriver() }), () => clock);
    const a = await sessions.issue(did);
    expect((await sessions.read(a.token)).accountId).toBe(did);
    clock += 60_001;
    await expect(sessions.read(a.token)).rejects.toMatchObject({ status: 401 });
    const renewed = await sessions.issue(did, a.token);
    const b = await sessions.issue("did:plc:other", renewed.token);
    expect(b.token).not.toBe(renewed.token);
    await expect(sessions.read(renewed.token)).rejects.toMatchObject({ status: 401 });
    await sessions.revoke(b.token);
    await expect(sessions.read(b.token)).rejects.toMatchObject({ status: 401 });
  });
  test("invalid linked cookies fail closed even when a valid local cookie is present", async () => {
    const event = new H3Event(new Request("https://keating.example/api/courses", {
      headers: { cookie: `keating_course_session=${"f".repeat(64)}; keating_course_account=${"a".repeat(32)}` },
    }));
    await expect(requireCourseProductSession(event)).rejects.toMatchObject({ status: 401 });
  });
  test("adopts only cookie-owned indexed membership and preserves authored content and progress", async () => {
    const store = createStorage({ driver: memoryDriver() });
    const original = course();
    await store.setItem("course:course_one", { course: original, appliedOperationIds: ["op_previous"] });
    await store.setItem(await indexKey(from), ["course_one", "course_other"]);
    await store.setItem("course:course_other", { course: { ...original, id: "course_other", ownerAccountId: "did:plc:someone", members: original.members.map(m => ({ ...m, accountId: "did:plc:someone" })) }, appliedOperationIds: [] });
    await adoptLocalCourses(from, did, store);
    const saved = await store.getItem<{ course: ReturnType<typeof course>; appliedOperationIds: string[] }>("course:course_one");
    expect(saved?.course.ownerAccountId).toBe(did);
    expect(saved?.appliedOperationIds).toEqual(["op_previous"]);
    expect(saved?.course.submissions[0]?.answer).toBe(original.submissions[0]!.answer);
    expect(projectCourseForViewer(saved!.course, did).viewer.accountId).toBe(did);
    expect(saved?.course.members[0]?.progress.completedLessonIds).toEqual(["lesson_one"]);
    expect(await store.getItem(await indexKey(did))).toEqual(["course_one"]);
    await adoptLocalCourses(from, did, store);
    await expect(adoptLocalCourses(from, "did:plc:other", store)).rejects.toThrow("already linked");
    expect(adoptCourseIdentity(saved!.course, from, did)).toEqual(saved!.course);
  });
  test("two browser devices link the same authoritative DID; idle requests reuse the bounded session", async () => {
    let posts = 0;
    const client = { config: { issuer: "https://issuer.example" }, getSession: () => ({ id: "login", accessToken: "opaque" }),
      headersFor: async () => new Headers({ authorization: "DPoP opaque", dpop: "proof" }) };
    const fetcher = (async () => { posts++; return Response.json({ account: { id: did }, expiresAt: Date.now() + 60_000 }); }) as unknown as typeof fetch;
    const a = new CourseAccountBridge(() => client as never, fetcher);
    const b = new CourseAccountBridge(() => client as never, fetcher);
    await Promise.all([a.ensure(), a.ensure(), b.ensure()]);
    expect(posts).toBe(2);
  });
  test("logout during verification clears the resulting cookie and discards the stale response", async () => {
    let signedIn = true;
    let release!: (value: Response) => void;
    let requested!: () => void;
    const pending = new Promise<void>(resolve => { requested = resolve; });
    const methods: string[] = [];
    const client = { config: { issuer: "https://issuer.example" }, getSession: () => signedIn ? { id: "login", accessToken: "opaque" } : null,
      headersFor: async () => new Headers() };
    const bridge = new CourseAccountBridge(() => client as never, (async (_url: string, init: RequestInit) => {
      methods.push(init.method!);
      if (init.method === "DELETE") return Response.json({ cleared: true });
      requested(); return await new Promise<Response>(resolve => { release = resolve; });
    }) as unknown as typeof fetch);
    const run = bridge.ensure();
    await pending; signedIn = false;
    release(Response.json({ account: { id: did }, expiresAt: Date.now() + 60_000 }));
    await expect(run).rejects.toThrow("changed");
    expect(methods).toEqual(["POST", "DELETE"]);
  });
});
