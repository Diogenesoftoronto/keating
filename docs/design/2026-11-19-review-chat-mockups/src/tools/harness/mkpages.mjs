// node mkpages.mjs <tag> <outJson> <path1> <path2> ...  -> writes a steps file that seeds then shoots each path
import { writeFileSync } from "node:fs";
const S = "/tmp/keating-design-shots";
const [tag, out, ...paths] = process.argv.slice(2);
const dark = process.env.DARK === "1";
const steps = [{ wait: 2000 }, { evalFile: `${S}/harness/seed.js` }];
for (const p of paths) {
  const name = p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
  steps.push({ goto: "http://localhost:3420" + p, settle: 6500 });
  if (dark) steps.push({ eval: "document.documentElement.classList.add('dark');'ok'" }, { wait: 1500 });
  steps.push({ evalFile: `${S}/harness/probe-page.js` });
  steps.push({ shot: `${S}/app/${tag}-${name}.png`, full: true });
}
writeFileSync(out, JSON.stringify(steps));
