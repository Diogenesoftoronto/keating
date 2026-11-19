import { expect, it } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Opt in against an already running web app; deterministic tests need no server.
const origin = process.env.KEATING_LANDING_TEST_URL;
it.skipIf(!origin)("the landing story, examples, study, films and destinations work in the browser", async () => {
  const driver = fileURLToPath(new URL("../../../docs/design/2026-11-19-review-chat-mockups/src/tools/harness/cdp.mjs", import.meta.url));
  const scratch = await mkdtemp(join(tmpdir(), "keating-landing-test-"));
  const steps: Record<string, unknown>[] = [];
  const checks: string[] = [];
  function check(label: string, expression: string) {
    steps.push({ eval: `(${expression}) ? ${JSON.stringify("PASS " + label)} : ${JSON.stringify("FAIL " + label)}` });
    checks.push(label);
  }
  const story = "document.querySelector('.lp-play')";
  const buttons = "document.querySelectorAll('.lp-beats button')";
  const beat = story + ".dataset.beat";
  check("four real story buttons", buttons + ".length === 4");
  steps.push({ eval: buttons + "[0].focus();" + buttons + "[0].click()" }, { wait: 1750 });
  check("focus holds the chosen beat", beat + " === '0' && " + buttons + "[0].getAttribute('aria-pressed') === 'true'");
  steps.push({ eval: "document.activeElement.blur()" }, { wait: 1800 });
  check("advances after focus leaves", beat + " === '1'");
  steps.push({ hoverSel: ".lp-beats button" }, { eval: buttons + "[0].click()" }, { wait: 1800 });
  check("pointer holds the chosen beat", beat + " === '0'");
  steps.push({ move: [1, 1] }, { scrollTo: ".lp-own" }, { wait: 1800 });
  check("offscreen play holds its place", beat + " === '0'");
  steps.push({ scrollTo: ".lp-hero" }, { reduce: true }, { wait: 6000 });
  check("reduced motion rests on the last beat", beat + " === '3' && " + buttons + "[3].getAttribute('aria-pressed') === 'true'");
  check("visual play has a text alternative", story + ".querySelector('.lp-stack').ariaHidden === 'true' && " + story + ".querySelector('.lp-sr').textContent.includes('cannot recall')");
  for (const [index, topic] of ["recursion", "photosynthesis", "probability"].entries()) {
    steps.push({ eval: `document.querySelectorAll('.lp-tabs button')[${index}].click()` }, { wait: 60 },
      { eval: "document.querySelector('.lp-guess button').click()" }, { wait: 60 });
    check(topic + " gives feedback", "document.querySelector('.lp-th [aria-live=polite]').textContent.length > 10");
  }
  check("composer is decorative", "!document.querySelector('.lp-dock :is(input,textarea,button,a,[tabindex])')");
  check("study table matches the marks", "document.querySelector('.lp-chart table').textContent.includes('−17%') && document.querySelectorAll('.lp-row').length === 3");
  steps.push({ eval: "document.querySelector('#short-reviews button').click()" }, { wait: 60 },
    { eval: "document.querySelector('#short-reviews button').click()" }, { wait: 60 });
  check("sample review reveals its answer", "document.querySelector('#short-reviews').textContent.includes('It returns without making a smaller call.')");
  steps.push({ eval: "document.querySelector('.lp-vig details').open = true; document.querySelector('.landing-plan__options button').click()" }, { wait: 60 });
  check("synth plan can change depth", "document.querySelectorAll('.lp-path > div').length === 2");
  check("four example screens", "document.querySelectorAll('.lp-pair .lp-vig h4').length === 4");
  check("session, course and guide destinations", "['/chat','/download','/courses','/chat?courseMode=create'].every(href => [...document.querySelectorAll('main a')].some(a => a.getAttribute('href') === href)) && !!document.querySelector('.lp-own a[href*=\u0022start-here\u0022]')");
  check("one real walkthrough", "document.querySelectorAll('.lp-shot video[preload=none] track[kind=captions]').length === 1");
  steps.push({ scrollTo: ".lp-shot button" }, { wait: 250 }, { clickSel: ".lp-shot button" }, { wait: 800 });
  check("walkthrough plays", "document.querySelector('.lp-shot video').currentTime > 0");
  steps.push({ eval: "document.querySelector('.lp-shot video').pause()" }, { scrollTo: ".lp-intro button" }, { wait: 250 }, { clickSel: ".lp-intro button" }, { wait: 800 });
  check("film opens with controls and captions", "document.querySelector('.lp-intro video').hidden === false && !!document.querySelector('.lp-intro video[controls] track')");
  steps.push({ scrollTo: ".lp-intro button" }, { wait: 250 }, { clickSel: ".lp-intro button" }, { resize: [320, 800] }, { wait: 100 });
  steps.push({ eval: "document.documentElement.dataset.fx = 'off'; document.documentElement.classList.add('dark')" }, { wait: 60 });
  check("film closes", "document.querySelector('.lp-intro video').hidden");
  check("phone fits", "document.documentElement.scrollWidth <= innerWidth");
  try {
    const path = join(scratch, "steps.json");
    await writeFile(path, JSON.stringify(steps));
    const process = Bun.spawn(["node", driver, origin!, "1440", "900", path], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    expect(code, stderr).toBe(0);
    for (const label of checks) expect(stdout, label).toContain('EVAL "PASS ' + label + '"');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 90000);
