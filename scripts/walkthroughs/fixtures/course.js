const client = await import("/src/courses/client.ts");
const { ensureCourseAccountSession } = await import("/src/courses/account-session.ts");
if (location.origin !== new URL(base).origin || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
  throw new Error("Course fixtures require the loopback app.");
}
await ensureCourseAccountSession();
const response = await fetch("/api/courses/session");
const { account } = await response.json();
if (!response.ok || account?.mode !== "local") {
  throw new Error("Course fixtures require a browser-local course account.");
}
const { input, operations, document } = data;
const courseId = /^\/courses\/([^/]+)$/.exec(location.pathname)?.[1];
let snapshot = courseId ? await client.getCourse(courseId) : await client.createCourse(input);
async function apply(operation) {
  const result = await client.applyCourseOperation({
    ...operation,
    id: client.newCourseOperationId(),
    courseId: snapshot.course.id,
    baseRevision: snapshot.course.revision,
  }, account.id);
  snapshot = result.snapshot;
}
if (courseId) {
  await apply({ type: "course.update", patch: { description: input.description, outcomes: input.outcomes } });
  for (const module of input.modules) await apply({ type: "module.upsert", module });
  for (const card of input.cards) await apply({ type: "card.upsert", card });
}
if (document) {
  const { fileName, content, ...labels } = document;
  snapshot = await client.uploadCourseMaterial(snapshot.course.id,
    new File([content], fileName, { type: "text/plain" }), labels);
}
for (const operation of operations) await apply(operation);
