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
  const toggle = ".lp-play-toggle";
  const reaction = "document.querySelector('.frustration-clip video')";
  steps.push({ eval: `new Promise(resolve => {
    const deadline = performance.now() + 12000;
    function waitForLanding() {
      if (document.querySelector('${toggle}') || performance.now() >= deadline) resolve();
      else setTimeout(waitForLanding, 50);
    }
    waitForLanding();
  })` });
  check("landing omits eyebrows and repeated example labels", "!document.querySelector('.lp .k-eyebrow, .lp-disc') && !document.querySelector('.lp').innerText.includes('Example lesson')");
  check("hero uses the standard letterforms", "!/(^| )discretionary-ligatures( |$)/.test(getComputedStyle(document.querySelector('.lp-hero h1')).fontVariantLigatures)");
  check("four real story buttons", buttons + ".length === 4");
  steps.push({ eval: buttons + "[0].focus();" + buttons + "[0].click()" }, { wait: 1750 });
  check("selection holds the chosen beat", beat + " === '0' && " + buttons + "[0].getAttribute('aria-pressed') === 'true'");
  steps.push({ clickSel: toggle }, { hoverSel: ".lp-stack" }, { wait: 1800 });
  check("story advances under the pointer", beat + " === '1' && " + story + ".matches(':hover')");
  steps.push({ clickSel: toggle }, { wait: 1800 });
  check("pause holds the current beat", beat + " === '1'");
  steps.push({ eval: buttons + "[0].click()" }, { clickSel: toggle }, { scrollTo: ".lp-own" }, { wait: 1800 });
  check("offscreen play holds its place", beat + " === '0'");
  steps.push({ scrollTo: ".lp-chart" }, { wait: 450 });
  check("study chart animates when scrolled into view", "document.querySelector('.lp-chart').dataset.entered === 'true' && getComputedStyle(document.querySelector('.lp-chart .lp-up')).animationName === 'lp-chart-grow' && getComputedStyle(document.querySelector('.lp-chart .lp-nil')).animationName === 'lp-chart-point'");
  steps.push({ scrollTo: ".frustration-clip" }, { wait: 900 });
  check("the original CRT reaction plays once, silently and without controls",
    `${reaction}.currentSrc.includes('office-rage') && ${reaction}.muted && !${reaction}.loop && ${reaction}.currentTime > 0 && !document.querySelector('.frustration-clip :is(button, input, video[controls])')`);
  steps.push({ reduce: true }, { eval: `new Promise(resolve => {
    const deadline = performance.now() + 2000;
    function checkPaused() {
      if ((${reaction}.paused && ${reaction}.hidden) || performance.now() >= deadline) resolve();
      else setTimeout(checkPaused, 50);
    }
    checkPaused();
  })` });
  check("reduced motion shows the reaction poster", `${reaction}.paused && ${reaction}.hidden && !!document.querySelector('.frustration-clip img')`);
  steps.push({ scrollTo: ".lp-hero" });
  check("reduced motion rests on the last beat", beat + " === '3' && " + buttons + "[3].getAttribute('aria-pressed') === 'true'");
  check("visual play has a text alternative", story + ".querySelector('.lp-stack').ariaHidden === 'true' && " + story + ".querySelector('.lp-sr').textContent.includes('cannot recall')");
  for (const [index, topic] of ["recursion", "photosynthesis", "probability"].entries()) {
    steps.push({ eval: `document.querySelectorAll('.lp-tabs button')[${index}].click()` }, { wait: 60 },
      { eval: "document.querySelector('.lp-guess button').click()" }, { wait: 60 });
    check(topic + " gives feedback", "document.querySelector('.lp-th [aria-live=polite]').textContent.length > 10");
  }
  check("composer is decorative", "!document.querySelector('.lp-dock :is(input,textarea,button,a,[tabindex])')");
  check("study chart links to the paper and keeps the results accessible", "!document.querySelector('.lp-chart :is(table, details)') && !!document.querySelector('.lp-chart a[href*=\"10.1073/pnas.2422633122\"]') && document.querySelector('.lp-chart figure').getAttribute('aria-label').includes('−17%') && document.querySelectorAll('.lp-row').length === 3");
  check("study chart stays still with reduced motion", "getComputedStyle(document.querySelector('.lp-chart .lp-up')).animationName === 'none'");
  steps.push({ eval: "document.querySelector('#short-reviews button').click()" }, { wait: 60 },
    { eval: "document.querySelector('#short-reviews button').click()" }, { wait: 60 });
  check("sample review reveals its answer", "document.querySelector('#short-reviews').textContent.includes('It returns without making a smaller call.')");
  steps.push({ eval: "document.querySelector('.lp-vig details').open = true; document.querySelector('.landing-plan__options button').click()" }, { wait: 60 });
  check("synth plan can change depth", "document.querySelectorAll('.lp-path > div').length === 2");
  check("four example screens", "document.querySelectorAll('.lp-pair .lp-vig h4').length === 4");
  check("session, course and guide destinations", "['/chat','/download','/courses','/chat?courseMode=create'].every(href => [...document.querySelectorAll('main a')].some(a => a.getAttribute('href') === href)) && !!document.querySelector('.lp-own a[href*=\u0022start-here\u0022]')");
  check("four real walkthroughs", "document.querySelectorAll('.lp-clip video[preload=none] track[kind=captions]').length === 4");
  const rail = "document.querySelector('.lp-clips')";
  const nextWalkthrough = '.lp-watch-controls button[aria-label="Next walkthrough"]';
  const previousWalkthrough = '.lp-watch-controls button[aria-label="Previous walkthrough"]';
  const position = "document.querySelector('.lp-watch-position').textContent.trim()";
  const firstVideo = "document.querySelector('.lp-clip video')";
  const firstPlay = '.lp-clip button[aria-label="Play A lesson in chat"]';
  check("walkthroughs use a large horizontally scrolling preview", `${rail}.scrollWidth > ${rail}.clientWidth && document.querySelector('.lp-clip .landing-video').offsetWidth > ${rail}.clientWidth * 0.8`);
  steps.push({ scrollTo: firstPlay }, { wait: 250 }, { clickSel: firstPlay }, { wait: 800 });
  check("walkthrough uses custom playback controls", `!${firstVideo}.controls && ${firstVideo}.currentTime > 0 && !!document.querySelector('.lp-clip button[aria-label="Pause A lesson in chat"]')`);
  steps.push({ clickSel: '.lp-clip input[type=range]' }, { wait: 450 });
  check("custom seek changes playback position", `${firstVideo}.currentTime > 10`);
  steps.push({ clickSel: '.lp-clip button[aria-label="Captions"]' }, { wait: 150 });
  check("custom captions toggle enables the track", `${firstVideo}.textTracks[0].mode === 'showing'`);
  steps.push({ scrollTo: ".lp-watch-header" }, { clickSel: nextWalkthrough }, { wait: 450 });
  check("next walkthrough moves the track and pauses the first recording", `${position} === '2 / 4' && ${rail}.scrollLeft > 0 && ${firstVideo}.paused`);
  steps.push({ clickSel: previousWalkthrough }, { wait: 450 });
  check("previous walkthrough returns to the first recording", `${position} === '1 / 4' && ${rail}.scrollLeft === 0`);
  steps.push({ eval: `${rail}.focus(); ${rail}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));` }, { wait: 450 });
  check("arrow keys navigate the focused walkthrough track", `${position} === '2 / 4'`);
  steps.push({ eval: `${rail}.scrollTo({ left: ${rail}.scrollWidth, behavior: 'instant' });` }, { wait: 450 });
  check("native scrolling reaches the last walkthrough", `${position} === '4 / 4' && document.querySelector(${JSON.stringify(nextWalkthrough)}).getAttribute('aria-disabled') === 'true'`);
  const filmToggle = ".lp-intro > button";
  const filmPlayer = "document.querySelector('.lp-intro .landing-video')";
  const film = "document.querySelector('.lp-intro video')";
  steps.push({ scrollTo: filmToggle }, { wait: 250 }, { clickSel: filmToggle }, { wait: 900 });
  check("the film opens and plays with custom controls", `!${filmPlayer}.hidden && !${film}.controls && ${film}.currentTime > 0 && !!document.querySelector('.lp-intro track[kind=captions]')`);
  steps.push({ scrollTo: '.lp-intro button[aria-label="Mute"]' }, { wait: 200 }, { clickSel: '.lp-intro button[aria-label="Mute"]' }, { wait: 150 });
  check("the custom mute button controls the film audio", `${film}.muted && !!document.querySelector('.lp-intro button[aria-label="Unmute"]')`);
  steps.push({ resize: [320, 800] }, { wait: 100 });
  check("custom film controls fit on a phone", "document.querySelector('.lp-intro .landing-video__controls').scrollWidth <= document.querySelector('.lp-intro .landing-video__controls').clientWidth");
  steps.push({ scrollTo: filmToggle }, { wait: 250 }, { clickSel: filmToggle }, { wait: 100 });
  steps.push({ eval: "document.documentElement.dataset.fx = 'off'; document.documentElement.classList.add('dark')" }, { wait: 60 });
  check("film closes and pauses", `${filmPlayer}.hidden && ${film}.paused`);
  check("phone fits", "document.documentElement.scrollWidth <= innerWidth");
  check("phone retains a large video and a horizontal track", `document.querySelector('.lp-clip .landing-video').offsetWidth > ${rail}.clientWidth * 0.85 && ${rail}.scrollWidth > ${rail}.clientWidth`);
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
