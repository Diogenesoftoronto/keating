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
  steps.push({ eval: "document.querySelectorAll('.lp-tabs button')[0].click()" }, { wait: 80 },
    { eval: "document.querySelector('.landing-practice .keating-select').scrollIntoView({ block: 'center' })" }, { wait: 250 },
    { eval: "document.querySelector('.landing-practice .keating-select').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))" }, { wait: 400 });
  check("the return-value select opens anchored under its trigger", "(t => { const m = document.querySelector('.keating-select-menu'); if (!m) return false; const a = t.getBoundingClientRect(), b = m.getBoundingClientRect(); return Math.abs(b.left - a.left) < 2 && b.top - a.bottom >= 0 && b.top - a.bottom < 16; })(document.querySelector('.landing-practice .keating-select'))");
  steps.push({ eval: "[...document.querySelectorAll('.keating-select-option')].find(o => o.textContent.includes('A. 0')).click()" }, { wait: 250 });
  check("choosing a return value fills the slot and enables lock-in", "document.querySelector('.landing-practice [data-matching-row]').textContent.includes('0') && [...document.querySelectorAll('.landing-practice button')].some(b => b.textContent.includes('Lock in'))");
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
  const clipBoxes = "[...document.querySelectorAll('.lp-clip')].map(clip => clip.getBoundingClientRect())";
  const firstVideo = "document.querySelector('.lp-clip video')";
  const secondVideo = "document.querySelectorAll('.lp-clip video')[1]";
  const firstPlay = '.lp-clip button[aria-label="Play A lesson in chat"]';
  const secondPlay = '.lp-clip button[aria-label="Play Reading a session back"]';
  check("desktop reads at the 150% reference scale", "getComputedStyle(document.querySelector('.landing-page')).zoom === '1.5'");
  check("walkthroughs sit two up beside the first, with no hidden track", `(b => Math.abs(b[0].top - b[1].top) < 2 && b[1].left > b[0].right && b[2].top > b[0].bottom)(${clipBoxes}) && ${rail}.scrollWidth <= ${rail}.clientWidth && !document.querySelector('.lp-watch-controls')`);
  steps.push({ scrollTo: firstPlay }, { wait: 250 }, { clickSel: firstPlay }, { wait: 800 });
  check("walkthrough uses custom playback controls", `!${firstVideo}.controls && ${firstVideo}.currentTime > 0 && !!document.querySelector('.lp-clip button[aria-label="Pause A lesson in chat"]')`);
  steps.push({ clickSel: '.lp-clip input[type=range]' }, { wait: 450 });
  check("custom seek changes playback position", `${firstVideo}.currentTime > 10`);
  steps.push({ clickSel: '.lp-clip button[aria-label="Captions"]' }, { wait: 150 });
  check("custom captions toggle enables the track", `${firstVideo}.textTracks[0].mode === 'showing'`);
  steps.push({ clickSel: secondPlay }, { wait: 800 });
  check("starting another walkthrough pauses the first", `${firstVideo}.paused && !${secondVideo}.paused`);
  steps.push({ eval: `${secondVideo}.pause()` });
  const filmToggle = ".lp-intro > button";
  const filmPlayer = "document.querySelector('.lp-intro .landing-video')";
  const film = "document.querySelector('.lp-intro video')";
  // The zoomed desktop nav is taller than the harness default 80px scroll offset.
  steps.push({ scrollTo: filmToggle, top: 200 }, { wait: 250 }, { clickSel: filmToggle }, { wait: 900 });
  check("the film opens and plays with custom controls", `!${filmPlayer}.hidden && !${film}.controls && ${film}.currentTime > 0 && !!document.querySelector('.lp-intro track[kind=captions]')`);
  steps.push({ scrollTo: '.lp-intro button[aria-label="Mute"]', top: 200 }, { wait: 200 }, { clickSel: '.lp-intro button[aria-label="Mute"]' }, { wait: 150 });
  check("the custom mute button controls the film audio", `${film}.muted && !!document.querySelector('.lp-intro button[aria-label="Unmute"]')`);
  steps.push({ resize: [320, 800] }, { wait: 100 });
  check("custom film controls fit on a phone", "document.querySelector('.lp-intro .landing-video__controls').scrollWidth <= document.querySelector('.lp-intro .landing-video__controls').clientWidth");
  steps.push({ scrollTo: filmToggle, top: 200 }, { wait: 250 }, { clickSel: filmToggle }, { wait: 100 });
  steps.push({ eval: "document.documentElement.dataset.fx = 'off'; document.documentElement.classList.add('dark')" }, { wait: 60 });
  check("film closes and pauses", `${filmPlayer}.hidden && ${film}.paused`);
  check("phone fits", "document.documentElement.scrollWidth <= innerWidth");
  check("phone stacks the walkthroughs directly after one another", `(b => b.every((box, i) => i === 0 || (box.top - b[i - 1].bottom >= 0 && box.top - b[i - 1].bottom < 16 && Math.abs(box.left - b[0].left) < 2)))(${clipBoxes}) && document.querySelector('.lp-clip .landing-video').offsetWidth > ${rail}.clientWidth * 0.95`);
  check("phone keeps the original layout scale", "getComputedStyle(document.querySelector('.landing-page')).zoom === '1'");
  check("phone menu label is centred in its trigger", "(b => { const r = b.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(b); const t = range.getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - (t.top + t.bottom) / 2) < 1.5; })(document.querySelector('.nav-mobile-toggle'))");
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
