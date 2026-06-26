import { loadKeatingConfig, writeKeatingConfig, type KeatingConfig } from "./config.js";

export interface RecommendedPiPackage {
  source: string;
  label: string;
  description: string;
}

export const RECOMMENDED_PI_PACKAGES: RecommendedPiPackage[] = [
  {
    source: "npm:pi-subagents",
    label: "Subagents",
    description: "Adds subagent-style delegation workflows to Pi."
  },
  {
    source: "npm:pi-web-access",
    label: "Web access",
    description: "Adds browser/web research helpers that pair well with tutoring and verification."
  },
  {
    source: "npm:@gotgenes/pi-permission-system",
    label: "Permission system",
    description: "Adds a confirmation/safety layer that is useful before enabling powerful third-party agent packages."
  }
];

export function normalizePiPackageSource(source: string): string {
  return source.trim();
}

export function normalizePiPackages(packages: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of packages ?? []) {
    const source = normalizePiPackageSource(item);
    if (!source || seen.has(source)) continue;
    seen.add(source);
    result.push(source);
  }
  return result;
}

function withPiPackages(config: KeatingConfig, packages: string[]): KeatingConfig {
  return {
    ...config,
    pi: {
      ...config.pi,
      packages
    }
  };
}

export async function listConfiguredPiPackages(cwd: string): Promise<string[]> {
  const config = await loadKeatingConfig(cwd);
  return normalizePiPackages(config.pi.packages);
}

export async function addConfiguredPiPackage(cwd: string, source: string): Promise<string[]> {
  const config = await loadKeatingConfig(cwd);
  const packages = normalizePiPackages([...(config.pi.packages ?? []), source]);
  await writeKeatingConfig(cwd, withPiPackages(config, packages));
  return packages;
}

export async function removeConfiguredPiPackage(cwd: string, source: string): Promise<string[]> {
  const target = normalizePiPackageSource(source);
  const config = await loadKeatingConfig(cwd);
  const packages = normalizePiPackages(config.pi.packages).filter((item) => item !== target);
  await writeKeatingConfig(cwd, withPiPackages(config, packages));
  return packages;
}

export function recommendedPiPackagesMarkdown(): string {
  return [
    "Recommended Pi packages for Keating:",
    "",
    ...RECOMMENDED_PI_PACKAGES.map((pkg) => `- ${pkg.source} — ${pkg.label}: ${pkg.description}`),
    "",
    "Add one with:",
    "  keating package add npm:pi-subagents",
    "",
    "Or inside the Keating shell:",
    "  /packages add npm:pi-subagents"
  ].join("\n");
}

