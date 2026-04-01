import { spawnSync } from "node:child_process";

const diagrams = [
  ["docs/hyperteacher-architecture.mmd", "docs/hyperteacher-architecture.svg"],
  ["docs/visual-pipeline.mmd", "docs/visual-pipeline.svg"],
  ["docs/oxdraw-workflow.mmd", "docs/oxdraw-workflow.svg"]
];

for (const [input, output] of diagrams) {
  const result = spawnSync("oxdraw", ["--input", input, "--output", output], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
