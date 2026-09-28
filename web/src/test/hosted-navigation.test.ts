import { afterEach, describe, expect, it } from "bun:test";
import { AppLink } from "../components/AppLink";
import { applicationRootHref, hostedNavigationHref, isApplicationPath } from "../lib/hosted-navigation";

const originalWindow = globalThis.window;
afterEach(() => { globalThis.window = originalWindow; });

describe("hosted site and application navigation", () => {
  it("keeps the website root on the website", () => {
    expect(hostedNavigationHref("/", "keating.help", false)).toBe("/");
    expect(applicationRootHref("keating.help", false)).toBe("https://chat.keating.help/");
  });
  it.each(["/chat", "/usage", "/bench", "/courses/example", "/coming-up", "/live", "/review/sessions/id", "/join/code"])("opens site application link %s on the app origin", path => {
    expect(isApplicationPath(path)).toBe(true);
    expect(hostedNavigationHref(path, "keating.help", false)).toBe(`https://chat.keating.help${path === "/chat" ? "/" : path}`);
  });
  it("keeps direct chat root and compatible query links on the application", () => {
    expect(applicationRootHref("chat.keating.help", true)).toBe("/");
    expect(hostedNavigationHref("/chat?session=abc#turn", "chat.keating.help", true)).toBe("/?session=abc#turn");
    expect(hostedNavigationHref("/courses/example", "chat.keating.help", true)).toBe("/courses/example");
  });
  it.each(["/pricing", "/download", "/paper", "/terms", "/privacy"])("opens app public link %s on the apex", path => {
    expect(hostedNavigationHref(path, "chat.keating.help", true)).toBe(`https://keating.help${path}`);
  });
  it("keeps development routes local and external URLs untouched", () => {
    expect(hostedNavigationHref("/chat", "localhost", false)).toBe("/chat");
    expect(hostedNavigationHref("/courses", "localhost", false)).toBe("/courses");
    expect(hostedNavigationHref("//other.test/chat", "keating.help", false)).toBe("//other.test/chat");
  });
  it("preserves course handoff params and search when crossing origins", () => {
    globalThis.window = { location: { hostname: "keating.help" } } as unknown as Window & typeof globalThis;
    const link = AppLink({ to: "/chat", search: { ask: "Build a course?", courseMode: "create" } } as unknown as Parameters<typeof AppLink>[0]);
    const url = new URL(link.props.to);
    expect(url.origin).toBe("https://chat.keating.help");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("ask")).toBe("Build a course?");
    expect(url.searchParams.get("courseMode")).toBe("create");
    const course = AppLink({ to: "/courses/$courseId", params: { courseId: "biology" } } as unknown as Parameters<typeof AppLink>[0]);
    expect(course.props.to).toBe("https://chat.keating.help/courses/biology");
  });
});
