import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here=import.meta.dir, root=resolve(here,"../../../../..");
const {chromium}=createRequire(join(root,"spikes/flue-host/package.json"))("playwright-core");
const source=process.argv.includes("--built")?join(root,"web/.output/public/reports/teaching-interfaces/final-review"):resolve(here,"..");
const url=pathToFileURL(join(source,"index.html")).href, analysis=JSON.parse(readFileSync(join(source,"analysis.json")));
const browser=await chromium.launch(), results=[];
try {
  for(const width of [390,1280]) {
    const context=await browser.newContext({viewport:{width,height:850},colorScheme:width===390?"dark":"light",reducedMotion:"reduce",offline:true});
    const page=await context.newPage(), errors=[], network=[];
    page.on("pageerror",e=>errors.push(e.message));
    await page.route(/^https?:/i,async route=>{network.push(route.request().url());await route.abort();});
    await page.goto(url);
    await page.getByRole("heading",{name:"What reached the learner?"}).waitFor();
    const table=page.getByRole("table").first();
    assert.equal(await table.locator("tbody tr").first().locator("td").nth(1).textContent(),"4 / 5");
    await page.getByLabel("Measure",{exact:true}).selectOption("fit");
    for(const [i,row] of analysis.counts.entries()){
      const cells=table.locator("tbody tr").nth(i).locator("td");
      assert.equal(await cells.first().textContent(),row.first.pass+" / "+row.first.observed);
      assert.equal(await cells.nth(1).textContent(),row.final.pass+" / "+row.final.observed);
    }
    const live=page.locator(".fr-live-replay");
    await live.locator(":scope > summary").click();
    const slider=live.getByRole("slider").first();
    assert.equal(await slider.inputValue(),"6");
    await slider.press("ArrowRight");
    assert.equal(await slider.inputValue(),"7");
    assert.match(await live.locator("[data-simulation-readout] dd").first().textContent(),/84\.00/);
    await live.locator(":scope > summary").click();
    // All four observed irrigation replies can be exercised at two settings, including
    // the unguided reply that adds an optional second parameter at its default of one.
    for(const cell of analysis.cells.filter(r=>r.caseId==="irrigation"&&r.finalComponents?.includes("simulation"))){
      await page.goto(url+"#"+cell.id);
      const body=page.getByRole("article",{name:"Original tutor response"});
      const input=body.getByRole("slider").first(), readout=body.locator("[data-simulation-readout] dd").first();
      const before=Number(await input.inputValue());
      assert(Math.abs(parseFloat(await readout.textContent())-before*6)<1e-8,cell.id);
      await input.press("ArrowRight");
      const after=Number(await input.inputValue());assert.notEqual(before,after);
      assert(Math.abs(parseFloat(await readout.textContent())-after*6)<1e-8,cell.id);
    }
    await page.goto(url+"#irrigation--minimax--jev");
    await page.getByLabel("Learner task").selectOption("paper-fold");
    const reply=page.getByRole("article",{name:"Original tutor response"});
    assert.match(await reply.innerText(),/How many layers/i);
    assert.equal(await reply.locator("[data-question-kind]").count(),0);
    await page.getByRole("button",{name:"After the fix · offline replay"}).click();
    await reply.locator("[data-question-kind]").first().waitFor();
    await page.getByRole("button",{name:"First draft"}).click();
    await reply.locator("[data-question-kind]").first().waitFor();
    const choice=reply.locator("label.shared-activity__choice").filter({has:page.getByText(/^4 layers$/i,{exact:true})});
    await choice.click();
    await reply.getByRole("button",{name:/Send answer|Finish check/i}).click();
    await reply.getByText("Answer recorded in this replay.").waitFor();
    assert.match(page.url(),/#paper-fold--minimax--jev$/);
    await page.getByLabel("Tutor",{exact:true}).selectOption("flash");
    await page.getByLabel("Learner task").selectOption("python-sum");
    await page.getByRole("button",{name:"Released reply"}).click();
    const editor=reply.getByRole("textbox",{name:"Editable python starter"});
    const original=await editor.inputValue();assert(original.includes("[6, 9, 2]"));
    await editor.fill(original+"\n# replay");
    await reply.getByRole("button",{name:"Reset code"}).click();
    assert.equal(await editor.inputValue(),original);
    await page.getByLabel("Decision guidance").selectOption("google");
    await page.getByText("No released reply was observed for this case.").waitFor();
    await page.getByLabel("Learner task").selectOption("copper");
    assert.match(await reply.innerText(),/\bCu\b/);
    await page.getByLabel("Decision guidance").selectOption("none");
    await page.getByRole("button",{name:"Unguided output"}).waitFor();
    const latest=page.getByLabel("Final check"), outcome=page.getByRole("region",{name:"Final policy outcome"});
    const cases=JSON.parse(readFileSync(join(source,"final.json")));
    const latestCases=[...cases.additional.filter(row=>row.phase.endsWith("/prediction")||row.phase.endsWith("/addendum")),...cases.feedback.generated,cases.feedback.mounted,cases.feedback.postCorrection];
    assert.equal(await latest.locator("option").count(),latestCases.length);
    for(const recorded of latestCases){
      await latest.selectOption(recorded.id);
      assert.equal(await outcome.getByRole("link").getAttribute("href"),recorded.receipt);
      if(recorded.disposition==="released"){
        assert.equal(await outcome.getByText("The tutor did not release a teaching reply on this turn.").count(),0);
        const receipt=JSON.parse(readFileSync(join(source,recorded.receipt)));
        if(recorded.caseId==="authentic-confirmation") assert.match(await outcome.innerText(),/round/i);
        if(recorded.caseId==="tile-bag") await outcome.locator("[data-question-kind]").first().waitFor();
        if(recorded.caseId==="multiples-loop") assert.match(await outcome.getByRole("textbox").inputValue(),/for /);
        assert(receipt.public);
      } else {
        await outcome.getByText("The tutor did not release a teaching reply on this turn.").waitFor();
        if(recorded.id===cases.feedback.postCorrection.id){
          const third=outcome.locator("details").filter({has:page.getByText("Private draft 3 · review uncertain",{exact:true})});
          await third.locator("summary").click();
          assert.match(await third.innerText(),/mastery_overclaimed/);
          assert.match(await third.innerText(),/3 of the 4 tiles/);
          assert.match(await outcome.innerText(),/Couldn't produce a reply/);
        }
      }
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const links=await page.locator("footer a,.fr-live a").evaluateAll(nodes=>nodes.map(n=>n.href));
    for(const href of links){const link=new URL(href);link.search="";link.hash="";assert(existsSync(fileURLToPath(link)),href);}
    await page.goto(url+"#paper-fold--flash--jev");
    await page.getByRole("button",{name:"Released reply"}).click();
    await page.getByRole("heading",{name:"Follow a turn"}).scrollIntoViewIfNeeded();
    if(!process.argv.includes("--built")) await page.screenshot({path:join(here,width===390?"replay-mobile.png":"replay-desktop.png"),animations:"disabled"});
    await page.goto(new URL("../diagnostics.html?source=review&cue=implicit-action&view=draft-loss",url).href);
    await page.getByText("2 matching turns",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("Show turns").inputValue(),"selection");
    const draw=page.locator(".ou-drill").filter({has:page.getByLabel("Show turns")});
    assert.equal(await draw.locator("details").count(),2);
    await page.getByLabel("Decision model").selectOption("jev-1.14.0");
    await draw.getByText("1 matching turn",{exact:true}).waitFor();
    await draw.locator("details summary").first().click();
    assert.match(await draw.innerText(),/MiniMax-M2.7-highspeed/);
    assert.match(await draw.innerText(),/Attempt 3 · Best effort, unverified/);
    await page.goto(new URL("../diagnostics.html?source=review-first",url).href);
    await page.getByRole("heading",{name:"Does decision guidance help on the same case?"}).waitFor();
    await page.getByLabel("Decision model").selectOption("gemini-decision-1");
    const pairs=page.locator(".ou-pair").filter({has:page.getByText("Teaching assessment",{exact:true})});
    assert.equal(await pairs.count(),2);
    for(const pair of analysis.pairedFirstFit.filter(p=>p.decisionModel==="gemini-decision-1")){
      const table=pairs.filter({hasText:pair.model});
      const assessment=table.getByRole("row").filter({hasText:"Teaching assessment"}).locator("td");
      assert.equal(await assessment.nth(2).textContent(),String(pair.fit.pairs));
      assert.equal(await assessment.nth(3).textContent(),String(pair.fit.unknown));
    }
    await page.goto(new URL("../diagnostics.html?source=assessment-opt-out&view=assessment-opt-out",url).href);
    await page.getByText("2 matching turns",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("Show turns").inputValue(),"assessment-opt-out");
    assert.equal(await page.getByLabel("Data source").inputValue(),"assessment-opt-out");
    await page.goto(new URL("field-guide.html",url).href);
    assert.equal(await page.getByRole("heading",{level:1}).count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const guideLinks=await page.getByRole("link").evaluateAll(nodes=>nodes.map(n=>n.href));
    assert(guideLinks.length>0);
    for(const href of guideLinks) {
      const location=new URL(href);
      if(location.protocol!=="file:") continue;
      location.search="";location.hash="";
      assert(existsSync(fileURLToPath(location)),href);
    }
    await page.goto(new URL("report.html",url).href);
    assert.equal(await page.getByRole("heading",{level:1}).count(),1);
    assert.equal(await page.getByRole("table").count(),2);
    await page.getByText("Jump to a section",{exact:true}).click();
    await page.getByRole("link",{name:"Turn timing and historical evidence",exact:true}).click();
    assert.match(page.url(),/#turn-timing-and-historical-evidence$/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
    results.push({width,comparisonMatches:3,stageLight:[6,72,7,84],irrigationOutputsAtTwoSettings:4,questionSubmitted:true,proseAfterReview:true,editorChangedAndReset:true,
      finalPolicyCases:latestCases.length,fieldGuideLinks:guideLinks.length,missingGenerationRepresented:true,unguidedExercised:true,inspectorDraftLosses:2,filteredDecisionPairs:2,horizontalOverflow:false,pageErrors:errors,externalRequests:network});
    await context.close();
  }
} finally { await browser.close(); }
if(!process.argv.includes("--built")) writeFileSync(join(here,"browser-checks.json"),JSON.stringify(results,null,2)+"\n");
console.log(JSON.stringify({widths:results.map(r=>r.width),status:"verified",built:process.argv.includes("--built")}));
