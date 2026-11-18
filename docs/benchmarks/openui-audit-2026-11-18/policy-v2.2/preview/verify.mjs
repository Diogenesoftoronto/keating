// From the repository: rtk bun docs/benchmarks/openui-audit-2026-11-18/policy-v2.2/preview/verify.mjs
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { sha, read, hashFile } from "../../replay-source/tree.mjs";
import { inspectOpenUIDiagnosticText } from "../../../../../web/src/keating/openui/diagnostic-components.ts";
import { inspectEditableCodeEvidence } from "../../../../../web/src/keating/openui/editable-code-evidence.ts";
import { chromium, localUrl, offlinePage, opening } from "./browser.mjs";

const here = import.meta.dir, audit = resolve(here,"../..");
const url = localUrl(join(here,"index.html"));
const reports = [];
let fillingProof;
assert.ok(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === "--record");
const button = (page,name) => page.getByRole("button",{name,exact:true});
const numeric = async locator => Number((await locator.textContent()).trim().match(/^-?[\d,]+(?:\.\d+)?/u)[0].replaceAll(",",""));
const readout = (sim,id) => numeric(sim.locator('[data-simulation-readout="'+id+'"] dd'));
async function setSlider(locator, target) {
  const step = Number(await locator.getAttribute("step") ?? 1);
  const delta = (target-Number(await locator.inputValue()))/step;
  assert.ok(Number.isInteger(delta) && Math.abs(delta) < 150,"Invalid keyboard target");
  await locator.focus();
  for (let i=0;i<Math.abs(delta);i++) await locator.press(delta>0 ? "ArrowRight" : "ArrowLeft");
  assert.equal(Number(await locator.inputValue()),target);
}
async function source(page,expected) {
  const details = page.locator("details").filter({has:page.getByText("View the recorded reply and source",{exact:true})});
  await details.locator("summary").click();
  assert.equal(await details.locator("[data-original-text]").textContent(),expected);
  await details.locator("summary").click();
}
async function fits(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),false,"Page overflows viewport");
}
async function editAndRestore(page,original) {
  await button(page,"Edit code").click();
  const editor = page.getByRole("textbox",{name:"Editable Python code"});
  assert.equal(await editor.inputValue(),original);
  await editor.fill(original+"\n# local edit");
  assert.equal(await editor.inputValue(),original+"\n# local edit");
  await button(page,"Reset code").click();
  assert.equal(await editor.inputValue(),original);
  await button(page,"Show code").click();
  assert.equal(await page.locator(".starter pre").textContent(),original);
}
async function beltGeometry(frame) {
  return frame.locator("#belt").evaluate(belt => {
    const boxes = [...belt.children], bounds = belt.getBoundingClientRect();
    const positions = boxes.map(box => {
      const rect = box.getBoundingClientRect();
      return [rect.x - bounds.x, rect.y - bounds.y, rect.width, rect.height].join(",");
    });
    return {count:boxes.length,positions:[...new Set(positions)],animations:belt.getAnimations({subtree:true}).length,
      reducedMotion:matchMedia("(prefers-reduced-motion: reduce)").matches};
  });
}

const browser = await chromium.launch({headless:true});
try {
  for (const viewport of [{width:390,height:844},{width:1365,height:960}]) {
    const {page,context,healthy} = await offlinePage(browser,viewport);
    page.setDefaultTimeout(10000);
    await page.goto(url);
    await page.getByRole("heading",{name:"Change the conveyor speed"}).waitFor();
    const samples = JSON.parse(await page.locator("#replies").textContent());
    const conveyor = samples[2], evidence = conveyor.evidence;
    for (const sample of [...samples,evidence.native,...evidence.practice.rows]) {
      assert.equal(sha(sample.text),sample.digest);
      const record = read(join(audit,sample.source));
      assert.equal(record.public?.text ?? record.release.text,sample.text);
      assert.equal(inspectOpenUIDiagnosticText(sample.text).outsideWords,sample.words);
      if (sample.sourceSha256) assert.equal(hashFile(join(audit,sample.source)),sample.sourceSha256);
    }
    const sim = page.locator("[data-simulation]");
    const speed = sim.getByRole("slider",{name:"Belt speed (m/min)"});
    const spacing = sim.getByRole("slider",{name:"Carton spacing (m)"});
    const recordedGoogle = [];
    for (const value of [60,90]) {
      await setSlider(speed,value);
      const distance = Number(await spacing.inputValue()), output = await readout(sim,"total"), rate = await readout(sim,"rate");
      assert.equal(distance,10);
      assert.equal(output,10 * value/distance);
      assert.equal(rate,value/distance);
      recordedGoogle.push([value,output]);
    }
    await source(page,conveyor.text);
    await fits(page);
    await button(page,"Jev · Native page").click();
    const frameHost = page.locator("[data-native-page-status=ready]");
    await frameHost.waitFor();
    const frame = frameHost.frameLocator("iframe"), slider = frame.getByRole("slider");
    assert.equal(await frameHost.locator("iframe").getAttribute("sandbox"),"allow-scripts");
    const ledger = read(join(audit,"policy-v2.2/ledger.json"));
    const call = ledger.entries.find(e => e.id === evidence.native.ledgerEntry).message.content.find(c => c.name === "interactive_page");
    assert.equal(sha(JSON.stringify(call.arguments)),evidence.native.argumentsSha256);
    assert.equal(sha(call.arguments.html),evidence.native.htmlSha256);
    await button(page,"View the code").click();
    assert.equal(await page.getByLabel("Code for "+call.arguments.title).textContent(),call.arguments.html);
    await button(page,"Hide the code").click();
    const recordedNative = [];
    for (const value of [6,9]) {
      await setSlider(slider,value);
      const total = await numeric(frame.locator("#c10")), hourly = await numeric(frame.locator("#ch"));
      assert.deepEqual([total,hourly],[10*value,60*value]);
      recordedNative.push([value,total,hourly]);
    }
    const drawings = await beltGeometry(frame);
    assert.deepEqual(drawings,{count:12,positions:["1,7,32,32"],animations:0,reducedMotion:true});
    const natural = await offlinePage(browser,viewport,"no-preference");
    await natural.page.goto(url);
    await button(natural.page,"Jev · Native page").click();
    const normalHost = natural.page.locator("[data-native-page-status=ready]");
    await normalHost.waitFor();
    const normalFrame = normalHost.frameLocator("iframe");
    const normalGeometry = {...drawings,reducedMotion:false};
    assert.deepEqual(await beltGeometry(normalFrame),normalGeometry);
    await natural.page.waitForTimeout(500);
    assert.deepEqual(await beltGeometry(normalFrame),normalGeometry);
    await setSlider(normalFrame.getByRole("slider"),9);
    assert.deepEqual(await beltGeometry(normalFrame),normalGeometry);
    await natural.healthy();
    await natural.context.close();
    await page.bringToFront();
    await source(page,evidence.native.text);
    assert.deepEqual(evidence.native.tools,["set_learner_goal","interactive_page"]);
    await fits(page);

    const busLink = page.getByRole("link",{name:"Bus graph"});
    await busLink.scrollIntoViewIfNeeded();
    await busLink.focus();
    await busLink.press("Enter");
    await page.getByRole("heading",{name:"Which control does the graph open on?"}).waitFor().catch(async error => {
      throw Error("Bus navigation did not settle: "+JSON.stringify(await page.evaluate(() =>
        ({url:location.href, headings:[...document.querySelectorAll("h1,h2")].map(n => n.innerText),active:document.activeElement?.tagName,
          role:document.querySelector("nav a[aria-current]")?.textContent,
          hash:location.hash}))),{cause:error});
    });
    const busProof = [];
    for (const [i,sample] of samples.slice(0,2).entries()) {
      if (i) await button(page,"Gemini Decision").click();
      assert.equal(hashFile(join(audit,sample.archive)),sample.archivedPlayerSha256);
      const archived = await offlinePage(browser, {width:1100,height:880});
      await archived.page.goto(localUrl(join(audit,sample.archive))+"#bus");
      const old = archived.page.locator("main>section:not([hidden]) [data-simulation]");
      const {image,...expected} = sample.old;
      assert.deepEqual(await opening(old),expected);
      assert.equal(image,"data:image/png;base64,"+(await old.locator("figure").screenshot({animations:"disabled"})).toString("base64"));
      await archived.healthy();
      await archived.context.close();
      await page.bringToFront();
      const displayed = await opening(sim).catch(error => {
        throw Error("Missing live bus plot for "+sample.key+" at "+page.url(), {cause:error});
      });
      assert.equal(displayed.vary,"Buses per hour (buses)");
      assert.equal(displayed.watch,expected.watch);
      assert.notEqual(displayed.vary,expected.vary);
      const frequency = sim.getByRole("slider",{name:"Buses per hour (buses)"});
      const readings = [];
      for (const value of [8,16]) {
        await setSlider(frequency,value);
        const capacity = await readout(sim,"capacity"), available = await readout(sim,"available");
        assert.equal(capacity,40*value);
        assert.equal(available,i === 0 ? 40*value-(300+8*value) : (40*value)*.30);
        readings.push([value,capacity,available]);
      }
      await source(page,sample.text);
      await fits(page);
      busProof.push({reviewer:sample.reviewer,old:expected.vary,now:displayed.vary,readings});
    }
    await page.getByRole("link",{name:"Direct answer"}).click();
    assert.equal(await page.getByLabel("Recorded answer").locator("p").textContent(),"16.");
    const decisions = evidence.perimeter.decisions;
    assert.deepEqual(decisions.map(d => [d.score,d.prior,d.current]),[[.35,"released","released"],[.7374669921053815,"withheld","released"]]);
    assert.equal(await page.locator("table tbody tr").count(),2);
    await fits(page);
    await page.getByRole("link",{name:"Code practice"}).click();
    for (const [i,row] of evidence.practice.rows.entries()) {
      if (i) await button(page,"MiniMax · Python block").click();
      assert.equal(await page.locator(".starter pre").textContent(),row.starter);
      assert.equal(row.check,i ? "pass" : "fail");
      if (i) await editAndRestore(page,row.starter);
      await source(page,row.text);
      await fits(page);
    }
    await page.getByRole("link",{name:"Policy v2.3"}).click();
    await page.getByRole("heading",{name:"Fresh policy v2.3 cases"}).waitFor();
    const later = [];
    for (const [i,row] of evidence.final.entries()) {
      if (i === 2) await button(page,"Python practice").click();
      await button(page,i % 2 ? "Gemini Decision" : "Jev decision").click();
      const data = read(join(audit,row.source)), item = {task:row.task,decision:row.reviewer,status:row.status,
        source:row.source,words:row.public?.words ?? null,editorOutsideWords:row.public?.editorOutsideWords ?? null};
      assert.equal(hashFile(join(audit,row.source)),row.sourceSha256);
      assert.equal(await page.locator("[data-later-status]").getAttribute("data-later-status"),row.status);
      if (row.public) {
        assert.equal(data.public.text,row.public.text);
        await source(page,row.public.text);
        if (row.task === "filling-line") {
          const pump = sim.getByRole("slider",{name:"Pump rate (bottles/min)"});
          item.rateEightMinutesHour = [];
          for (const rate of [5,7.5]) {
            await setSlider(pump,rate);
            const total = await readout(sim,"total"), perHour = await readout(sim,"perHour");
            assert.deepEqual([total,perHour],[8*rate,60*rate]);
            item.rateEightMinutesHour.push([rate,total,perHour]);
          }
          if (viewport.width === 1365 && process.argv[2] === "--record") {
            fillingProof = await sim.screenshot({type:"png",animations:"disabled"});
          }
        } else if (row.public.python) {
          const observed = inspectEditableCodeEvidence(data.public.text);
          assert.equal(item.editorOutsideWords,observed.editorOutsideWords);
          assert.deepEqual([item.words,item.editorOutsideWords],row.reviewer === "Jev" ? [24,10] : [26,0]);
          await page.getByText(item.editorOutsideWords+" words around the Python editor",{exact:true}).waitFor();
          await editAndRestore(page,row.public.python);
          item.pythonEditReset = true;
        }
      } else {
        assert.equal(data.public,null);
        await page.getByRole("heading",{name:"No public reply recorded"}).waitFor();
        item.observation=row.disposition;
      }
      later.push(item);
      await fits(page);
    }
    await healthy();
    reports.push({googleConveyor:{source:conveyor.source,words:conveyor.words,spacingMetres:10,speedMetresPerMinuteAndTenMinuteCartons:recordedGoogle},
      nativeConveyor:{source:evidence.native.source,ledgerEntry:evidence.native.ledgerEntry,originalHtmlSha256:evidence.native.htmlSha256,
        words:evidence.native.words,rateTenMinuteCartonsHourlyCartons:recordedNative,
        cartons:drawings.count,distinctBoxPositions:drawings.positions.length,boxPixelsRelativeToBelt:drawings.positions[0].split(",").map(Number),
        activeAnimations:drawings.animations,normalAndReducedMotionMatched:true,elapsedObservationMs:500,
        cause:"The authored CSS absolutely positions every sample carton at the same top offset. The loop appends up to twelve without spacing or animation."},
      bus:busProof,perimeter:decisions,recordedPythonEditAndReset:true,languageChecks:evidence.practice.rows.map(s=>s.check),later});
    console.log(JSON.stringify({viewport:viewport.width,googleSpeedTenMinutes:recordedGoogle,
      nativeRateTenMinutesHour:recordedNative,nativeCartonsUniquePositions:drawings,
      bus:busProof,perimeter:decisions.map(d=>d.current),language:evidence.practice.rows.map(s=>s.check),
      externalRequests:0,browserErrors:0,cspViolations:0}));
    await context.close();
  }
} finally { await browser.close(); }
assert.deepEqual(reports[0],reports[1],"Viewports produced different teaching results");
const report = {version:1,environment:"Offline Chromium in a fresh local file context",viewports:[[390,844],[1365,960]],
  externalRequests:0,browserErrors:0,cspViolations:0,...reports[0]};
const target = join(here,"browser-results.json");
if (process.argv[2] === "--record") {
  assert.ok(fillingProof);
  writeFileSync(join(here,"filling-line-slider.png"),fillingProof);
  writeFileSync(target,JSON.stringify(report,null,2)+"\n");
}
else assert.deepEqual(read(target),report,"The saved browser results differ from the replay");
