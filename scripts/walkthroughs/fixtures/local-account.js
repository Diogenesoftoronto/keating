const { ensureCourseAccountSession } = await import("/src/courses/account-session.ts");
await ensureCourseAccountSession();
const response = await fetch("/api/courses/session");
const { account } = await response.json();
if (!response.ok || account?.mode !== "local") throw new Error("The walkthrough requires a disposable local account.");
