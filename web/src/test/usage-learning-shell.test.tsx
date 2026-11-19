import { expect, test } from "bun:test";
import { LearningShell } from "../components/LearningInsightsHeader";
import { UsageCharts } from "../components/UsageCharts";
import { renderWithRouter } from "./course-render";

test("the learning shell exposes the current section, actions and period controls", async () => {
  const html = await renderWithRouter(
    <LearningShell current="activity" actions={<button>Page action</button>} controls={<button>Period control</button>}>
      <main>Session history</main>
    </LearningShell>
  );
  expect(html).toMatch(/<a\b(?=[^>]*href="\/usage")(?=[^>]*aria-current="page")[^>]*>/);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  for (const target of ["/chat", "/bench", "/coming-up"]) expect(html).toContain(`href="${target}"`);
  expect(html.indexOf("Page action")).toBeLessThan(html.indexOf("Learning sections"));
  expect(html.indexOf("Period control")).toBeLessThan(html.indexOf("Session history"));
});

test("metadata and period panels render while full-history storage is pending", async () => {
  const html = await renderWithRouter(<UsageCharts sessionMetadata={[]} onOpenSession={() => {}}
    tiles={<span>Period totals</span>} recent={<span>Recent learning</span>} costs={<span>Models and cost</span>}/>);
  for (const text of ["Daily activity", "0 sessions across 0 active days", "Period totals", "Recent learning",
    "Models and cost", "Loading charts…", "View as table", "Is Keating improving?", "How sessions are landing"]) {
    expect(html).toContain(text);
  }
  expect(html).toMatch(/role="status" class="k-busy k-busy-inline"/);
  expect(html).toMatch(/<details class="lr-disclosure"><summary>Curriculum timeline/);
});

test("a recent period shows the latest active day's sessions without year controls", async () => {
  const today = new Date();
  const session = {id:"recent",title:"Testing recall",lastModified:today.toISOString(),messageCount:4};
  const html = await renderWithRouter(<UsageCharts range="7d" sessionMetadata={[session as import("../types/session").SessionMetadata]} onOpenSession={() => {}}/>);
  expect(html).toContain("Testing recall");
  expect(html).toContain("1 session across 1 active day");
  expect(html).not.toContain('class="lr-years"');
  expect(html.match(/class="kc-cell /g)?.length).toBeLessThanOrEqual(8);
});
