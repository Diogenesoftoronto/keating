import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {chromium, localUrl, offlinePage} from "../../policy-v2.2/preview/browser.mjs";

const browser = await chromium.launch({headless:true});
try {
  const receipts = ["frozen.json","current.json"].map(name=>JSON.parse(readFileSync(join(import.meta.dir,name))).probe);
  for(const viewport of [{width:1100,height:880},{width:390,height:800}]) {
    const {context,page,healthy} = await offlinePage(browser,viewport);
    try {
      await page.goto(localUrl(join(import.meta.dir,"index.html")));
      for(const [control, key] of [["languages","cases"],["help","proofCases"]]) {
        for(let i=0; i<receipts[0][key].length; i++) {
          await page.locator("#"+control).selectOption(String(i));
          for(const [j, r] of receipts.entries()) {
            const observation = r[key][i];
            const expected = control === "languages" ? observation.actionMatched ? "matched" : "missed" : observation.disposition;
            assert.equal((await page.locator("#"+control+j).innerText()).toLowerCase(),expected);
          }
        }
      }
      const programs=JSON.parse(readFileSync(join(import.meta.dir,"python-outputs.json")));
      const decisions=JSON.parse(readFileSync(join(import.meta.dir,"expected-output-replay.json"))).rows;
      for (const [i,program] of programs.entries()) {
        await page.locator("#oracle").selectOption(String(i));
        const row=decisions.find(r=>r.cell==="odd-filter--minimax--"+program.arm && r.attempt===program.attempt);
        assert.deepEqual(JSON.parse(await page.locator("#oracle0").innerText()),program.actual);
        assert.equal(await page.locator("#oracle1").innerText(),row.originalBlocking.length?"Blocked":"Approved");
        assert.equal((await page.locator("#oracle2").innerText()).toLowerCase(),row.singleCandidateNow);
      }
      await page.getByText("See the actual JavaScript starter").click();
      assert.match(await page.locator("pre").innerText(), /function get_all_items\(items\)/);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
      await healthy();
      console.log(JSON.stringify({viewport,languagePairs:4,gatePairs:4,pythonPrograms:4,externalRequests:0}));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
