import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseInvitationCard } from "../pages/CourseJoin";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";

const noop = () => {};
const props = { error: "", joining: false, needsConsent: false, onApprove: noop, onDecline: noop, onOpenLibrary: noop };

test("automatic join and invitation failures have distinct accessible states", () => {
  const pending = renderToStaticMarkup(<CourseInvitationCard {...props} />);
  expect(pending).toContain("Joining the course…");
  expect(pending.match(/role="status"/g)).toHaveLength(1);
  expect(pending).toContain("Your account is verified. Keating is adding this course to your library.");
  const failed = renderToStaticMarkup(<CourseInvitationCard {...props} error="This invitation has expired." />);
  expect(failed).toContain("Invitation unavailable");
  expect(failed).not.toContain('role="status"');
  expect(failed).toContain("This invitation has expired.");
  expect(failed).toContain("Open course library");
  expect(failed).not.toContain("Approve and join");
});

test("enrollment consent explains scope and keeps both decisions available", () => {
  const consent = renderToStaticMarkup(<CourseInvitationCard {...props} needsConsent />);
  expect(consent).toContain("<dl");
  expect(consent).toContain("current and future course work, tutoring threads, submissions, and progress");
  expect(consent).toContain("applies only to this course");
  expect(consent).toContain("Decline");
  expect(consent.indexOf("Decline")).toBeLessThan(consent.indexOf("Approve and join"));
  const approving = renderToStaticMarkup(<CourseInvitationCard {...props} needsConsent joining />);
  expect(approving.match(/disabled=""/g)).toHaveLength(2);
});

test("workspace gate renders verification and recovery for every access failure", () => {
  expect(renderToStaticMarkup(<CoursesAccessGate state={{ status: "loading" }} onRetry={noop} />)).toContain("Checking your course workspace");
  for (const recovery of ["account", "start-server", "retry"] as const) {
    const gate = renderToStaticMarkup(<CoursesAccessGate state={{ status: "unavailable", error: "Offline", recovery }} onRetry={noop} />);
    expect(gate).toContain("Offline");
    expect(gate).toContain(recovery === "account" ? "Check account" : "Retry course access");
    expect(gate.includes("devenv tasks run keating:web")).toBe(recovery === "start-server");
  }
});
