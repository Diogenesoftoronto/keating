import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

test("Sheet renders at 280px in both themes, with keyboard inspection and final reduced-motion marks", async () => {
  const {chromium} = createRequire(resolve(import.meta.dir,"../../../spikes/flue-host/package.json"))("playwright");
  const entry = resolve(import.meta.dir,"charts-sheet-entry.tsx");
  const built = await Bun.build({entrypoints:[entry],target:"browser",define:{"process.env.NODE_ENV":'"production"'},files:{[entry]:`
    import {createRoot} from "react-dom/client";
    import {Sheet} from "../design-system/Charts.stories";
    createRoot(document.querySelector("main")).render(Sheet.render());
  `}});
  if (!built.success) throw new AggregateError(built.logs);
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try {
    const page = await browser.newPage({viewport:{width:280,height:800},reducedMotion:"reduce"});
    const tokens = await Bun.file(resolve(import.meta.dir,"../../styled-system/styles.css")).text();
    await page.setContent('<html data-reduce-motion="true"><body><main></main></body></html>');
    await page.addStyleTag({content:tokens + await built.outputs.find(o=>o.path.endsWith(".css"))!.text()});
    await page.addScriptTag({content:await built.outputs.find(o=>o.path.endsWith(".js"))!.text()});
    const toggle = page.getByRole("button",{name:"Dark theme"});
    await toggle.waitFor();
    for (const theme of ["light","dark"]) {
      if (theme==="dark") await toggle.click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator(".kc-pending").evaluate((e: HTMLElement)=>getComputedStyle(e).backgroundImage)).toContain("gradient");
      expect(await page.evaluate(()=>Array.from(document.querySelectorAll("[data-kc-enter]")).flatMap(mark=>mark.getAnimations()).length)).toBe(0);
      if(process.env.KEATING_CHART_PREVIEW_DIR) {
        await page.setViewportSize({width:1050,height:900});
        await page.screenshot({path:resolve(process.env.KEATING_CHART_PREVIEW_DIR,theme+".png"),fullPage:true});
        await page.setViewportSize({width:280,height:800});
      }
    }
    const detail = page.getByRole("button",{name:"November 17, two learning sessions"});
    await detail.hover();
    const tooltip = page.getByRole("tooltip");
    expect(await tooltip.textContent()).toBe("November 17, two learning sessions");
    await detail.focus();
    await page.keyboard.press("Escape");
    await tooltip.waitFor({state:"detached",timeout:2500});
    expect(await tooltip.count()).toBe(0);
    await toggle.focus();
    await detail.focus();
    expect(await tooltip.textContent()).toBe("November 17, two learning sessions");
  } finally { await browser.close(); }
},30000);
