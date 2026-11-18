// The website Docker image contains web/public. Keep the report and its offline examples together there.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const study = import.meta.dir;
const repository = resolve(study, "../../..");
const output = resolve(study, "../../../web/public/reports/teaching-interfaces");
// Older downloadable reports also cite the original analysis code and Git-only evidence.
const repositoryLinkedReports = new Set([
  "REPORT.md", "diagnostics-followup.md", "gemini-decision/REPORT.md",
  "cue-paraphrases/README.md", "policy-v2.3-replay/README.md", "policy-v2.3.1-replay/README.md",
]);
const alongside = [
  "diagnostics.html",
  "showcase.html",
  "gemini-decision/comparison.html",
  "gemini-decision/preview/minimax-interfaces.html",
  "policy-holdout/preview/minimax-interfaces.html",
  "REPORT.md",
  "diagnostics-followup.md",
  "gemini-decision/REPORT.md",
  "policy-v2.2/REPORT.md",
  "policy-v2.2/preview/index.html",
  "policy-v2.2/preview/browser-results.json",
  "policy-v2.2/preview/filling-line-slider.png",
  "policy-v2.2/cohort.json",
  "policy-v2.2/summary.json",
  "policy-v2.2/turns.json",
  "policy-v2.3/cohort.json",
  "policy-v2.3-completion/summary.json",
  "policy-v2.3-completion/adjudication.json",
  "policy-v2.3-completion/protocol.json",
  "policy-v2.3-completion/check-python.py",
  "policy-v2.3-completion/turns.json",
  "policy-v2.3-replay/README.md",
  "policy-v2.3-replay/replay.json",
  "policy-v2.3.1-replay/README.md",
  "policy-v2.3.1-replay/replay.json",
  "policy-v2.3.2-review/README.md",
  "policy-v2.3.2-review/summary.json",
  "policy-v2.3.2-review/examples.json",
  "policy-v2.3.2-review/protocol.json",
  "policy-v2.3.2-review/ledger.json",
  "policy-v2.3.2-review/requests.json",
  "policy-v2.3.2-review/check-examples.py",
  "policy-v2.3.3-proof/replay.json",
  "policy-v2.3.3-proof/README.md",
  "cue-paraphrases/protocol.json",
  "cue-paraphrases/results.json",
  "cue-paraphrases/README.md",
  "evidence/MiniMax-M2.7-highspeed--prediction.json",
  "policy-holdout/MiniMax-M2.7-highspeed--spinner.json",
  "evidence/gemini-3.1-flash-lite--code.json",
  "scenarios.json",
  "verify-archived-cues.mjs",
  ...["index.html","report.html","REPORT.md","criteria.md","field-guide.html","field-notes.md","ratings.json","analysis.json","final.json","turns.json","first-drafts.json","production-window.json","production-build.json","python-execution.json",
    "study/cohort.json","study/summary.json","study/supplement/cohort.json","study/supplement/addendum/cohort.json",
    "study/feedback-v2.3.6/cohort.json","study/feedback-v2.3.6/summary.json","study/feedback-v2.3.6/review-stage.json",
    "study/classroom-v2.3.7/cohort.json","study/classroom-v2.3.7/stage.json","study/classroom-v2.3.7/summary.json","study/classroom-v2.3.7/manifest.json","study/classroom-v2.3.7/replay.json",
    "study/classroom-v2.3.7/receipts/classroom-tile-confirm--minimax--jev.json","typed-feedback/baseline.json","typed-feedback/requests.json","typed-feedback/README.md","typed-feedback/directive-replay.json",
    "study/classroom-v2.3.8/cohort.json","study/classroom-v2.3.8/stage.json","study/classroom-v2.3.8/summary.json","study/classroom-v2.3.8/old-plan.json","study/classroom-v2.3.8/manifest.json",
    "study/classroom-v2.3.8/receipts/classroom-tile-linked-feedback--minimax--jev.json","study/classroom-v2.3.8/comparison.json",
    ...Object.keys(JSON.parse(readFileSync(resolve(study,"final-review/study/feedback-v2.3.6/summary.json"),"utf8")).receipts)
      .map(id=>"study/feedback-v2.3.6/receipts/"+id+".json"),
    "cue-transfer/cases.json","cue-transfer/v2.3.5.json","cue-transfer/v2.3.6.json","classroom/cue-history.ts",
    "assessment-opt-out/turns.json","assessment-opt-out/evidence.json","classroom/linked-tile-confirm/staged-question.png",
    ...["coding","prediction","addendum"].flatMap(phase=>{
      const dir="study/supplement/"+phase;
      return [dir+"/summary.json",...Object.keys(JSON.parse(readFileSync(resolve(study,"final-review",dir,"summary.json"),"utf8")).receipts)
        .map(id=>dir+"/receipts/"+id+".json")];
    }),
    "audit/index.html","audit/current.json","audit/frozen.json","audit/recount.json","audit/cues.json","audit/README.md","audit/probe.mjs",
    "audit/expected-output-replay.json","audit/python-outputs.json","audit/check-python.py","preview/browser-checks.json",
    "classroom/index.html","classroom/README.md","classroom/FOLLOWUP.md","classroom/followup.json","classroom/selection-proof.ts","classroom/live-stage-light/browser-gate.json","classroom/live-stage-light/webmcp-and-cli.json","classroom/recorded-python/classroom-edit.png",
    "classroom/recorded-question/deterministic-grading.json","prediction-replay/baseline.json","prediction-replay/patched.json","prediction-replay/README.md",
    "classroom/final-python/classroom-edit.png",
    "classroom/final-prediction/typed-active-work.json","classroom/live-tile-confirm/notice-mobile-replay.png","classroom/live-tile-confirm/read-only-replay.json",
    ...["evidence.json","classroom-desktop.png","classroom-mobile.png","settings-export.json","settings-inspector.png","browser-gate.json","webmcp-and-cli.json"].map(name=>"classroom/live-tile-confirm/"+name),
    ...["evidence.json","classroom-desktop.png","classroom-mobile.png","settings-export.json","settings-inspector.png","browser-gate.json","webmcp-and-cli.json"].map(name=>"classroom/linked-tile-confirm/"+name),
    ...["live-stage-light","recorded-question","recorded-python","final-prediction","final-python"].flatMap(dir=>
      ["evidence.json","settings-export.json","classroom-after-action.png","classroom-desktop.png","classroom-mobile.png","settings-inspector.png"]
        .map(name=>"classroom/"+dir+"/"+name)),
    ...Object.keys(JSON.parse(readFileSync(resolve(study,"final-review/study/summary.json"),"utf8")).receipts)
      .map(id=>"study/receipts/"+id+".json"),
  ].map(name=>"final-review/"+name),
];
const recordings = ["november-audit", "policy-holdout", "decision-models", "terminal-episodes", "paired-benchmark", "policy-v2.2", "policy-v2.3","final-review","final-review-first","assessment-opt-out"];
if (!readFileSync(resolve(study,"final-review/assessment-opt-out/turns.json")).equals(readFileSync(resolve(study,"../../../web/src/keating/openui/examples/assessment-opt-out.json")))) {
  throw new Error("The Settings opt-out example must match the four measured simulation replies.");
}
const files = new Map<string, string>();
for (const name of alongside) files.set(resolve(study, name), name);
files.set(resolve(study, "../../openui-diagnostics.md"), "openui-diagnostics.md");
files.set(resolve(study, "../../../scripts/prompt-adherence/benchmark.ts"), "quality-checks/prompt-adherence-benchmark.ts.txt");
files.set(resolve(study, "../../../packages/learner-contracts/src/judgement/debugging-example-proof.ts"), "quality-checks/debugging-example-proof.ts.txt");
files.set(resolve(study, "../../../packages/learner-contracts/test/debugging-exercise.test.ts"), "quality-checks/debugging-exercise.test.ts.txt");
files.set(resolve(study, "../../../packages/learner-contracts/test/debugging-example-proof.test.ts"), "quality-checks/debugging-example-proof.test.ts.txt");
files.set(resolve(study, "../../../packages/learner-contracts/test/attempted-checkpoint-feedback.test.ts"), "quality-checks/attempted-checkpoint-feedback.test.ts.txt");
files.set(resolve(study, "../../../packages/learner-contracts/test/typed-attempt-directive.test.ts"), "quality-checks/typed-attempt-directive.test.ts.txt");
files.set(resolve(study, "../../../web/src/keating/judgement/draft-gate.ts"), "quality-checks/draft-gate.ts.txt");
files.set(resolve(study, "../../../packages/learner-contracts/src/judgement/teaching-policy.ts"), "quality-checks/teaching-policy.ts.txt");
for (const name of recordings) {
  files.set(resolve(study, "../../../web/src/keating/openui/examples", name + ".json"), "traces/" + name + ".json");
}
const article = resolve(study, "teaching-interfaces.html");
files.set(article, "index.html");

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--verify")) {
  throw new Error("Usage: bun package-page.ts [--verify]");
}
const verify = args[0] === "--verify";
const pages = new Map<string, Buffer>();
for (const [source, target] of files) {
  let bytes = readFileSync(source);
  if (source === article || target === "final-review/report.html") {
    const html = bytes.toString("utf8").replace(/href="([^"]+)"/g, (attribute, href: string) => {
      if (href.startsWith("#") || /^[a-z]+:/i.test(href)) return attribute;
      const [, localPath, suffix] = /^([^?#]+)(.*)$/.exec(href) ?? [];
      const published = localPath && files.get(resolve(dirname(source), localPath));
      if (!published) throw new Error("The article links to an unpackaged source: " + href);
      const download = source === article && published.endsWith(".md") ? " download" : "";
      return `href="${relative(dirname(target), published)}${suffix}"${download}`;
    });
    bytes = Buffer.from(html);
  }
  if (repositoryLinkedReports.has(target) || target === "openui-diagnostics.md" || target === "policy-v2.2/REPORT.md" || target.startsWith("final-review/") && target.endsWith(".md")) {
    bytes = Buffer.from(bytes.toString("utf8").replace(/\]\(([^)]+)\)/g, (whole, href: string) => {
      if (href.startsWith("#") || /^[a-z]+:/i.test(href)) return whole;
      const [, path, suffix] = /^([^?#]+)(.*)$/.exec(href) ?? [];
      if (!path || isAbsolute(path)) throw new Error("Invalid relative report reference " + href);
      const referencedFile = resolve(dirname(source), path);
      const dest = files.get(referencedFile);
      if (dest) return "](" + relative(dirname(target), dest) + suffix + ")";
      const repoPath = relative(repository, referencedFile);
      if (!repositoryLinkedReports.has(target) || !/^(docs|packages|scripts|web)\//.test(repoPath) ||
          repoPath.split("/").some(part => part.startsWith("."))) {
        throw new Error("Unpackaged report reference " + href);
      }
      const entry = statSync(referencedFile);
      if (!entry.isFile() && !entry.isDirectory()) throw new Error("Invalid repository source " + href);
      const route = entry.isDirectory() ? "tree" : "blob";
      const sourceUrl = "https://github.com/Diogenesoftoronto/keating/" + route + "/main/" + repoPath.split("/").map(encodeURIComponent).join("/");
      return '](' + sourceUrl + suffix + ' "Repository source online")';
    }));
  }
  pages.set(target, bytes);
}
for (const [target, bytes] of pages) {
  const path = join(output, target);
  if (verify) {
    if (!bytes.equals(readFileSync(path))) throw new Error("Rebuild the report asset " + target);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
}
console.log(`${verify ? "Verified" : "Packaged"} ${pages.size} teaching-interface report files.`);
