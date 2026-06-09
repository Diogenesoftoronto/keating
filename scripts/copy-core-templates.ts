#!/usr/bin/env bun
import { cp, mkdir, rm } from "node:fs/promises";

const sourceDir = "src/core/templates";
const targetDir = "dist/src/core/templates";

await rm(targetDir, { recursive: true, force: true });
await mkdir("dist/src/core", { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });

console.log(`Copied ${sourceDir} -> ${targetDir}`);
