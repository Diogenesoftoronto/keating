import {
  addConfiguredPiPackage,
  listConfiguredPiPackages,
  recommendedPiPackagesMarkdown,
  removeConfiguredPiPackage
} from "../../../core/pi-packages.js";
import { info } from "../ui-helpers.js";

function packageListText(packages: string[]): string {
  if (packages.length === 0) {
    return [
      "No extra Pi packages configured for Keating.",
      "",
      "Try:",
      "  /packages recommended",
      "  /packages add npm:pi-subagents"
    ].join("\n");
  }

  return [
    "Extra Pi packages configured for Keating:",
    ...packages.map((pkg) => `- ${pkg}`),
    "",
    "Restart `keating shell` after package changes so Pi can install/load missing packages."
  ].join("\n");
}

export async function runPiPackagesCommand(args: string | string[], ctx: any): Promise<void> {
  const parts = Array.isArray(args) ? args : String(args ?? "").trim().split(/\s+/).filter(Boolean);
  const subcommand = parts[0] ?? "list";

  if (subcommand === "list") {
    const packages = await listConfiguredPiPackages(ctx.cwd);
    ctx.ui.setEditorText(packageListText(packages));
    info(ctx, packages.length === 0 ? "No extra Pi packages configured." : `Loaded ${packages.length} package source${packages.length === 1 ? "" : "s"}.`);
    return;
  }

  if (subcommand === "recommended" || subcommand === "recommend") {
    ctx.ui.setEditorText(recommendedPiPackagesMarkdown());
    info(ctx, "Loaded recommended Pi packages for Keating.");
    return;
  }

  if (subcommand === "add") {
    const source = parts.slice(1).join(" ").trim();
    if (!source) {
      info(ctx, "Usage: /packages add npm:pi-subagents");
      return;
    }
    const packages = await addConfiguredPiPackage(ctx.cwd, source);
    ctx.ui.setEditorText(packageListText(packages));
    info(ctx, `Added ${source}. Restart keating shell if Pi needs to install/load it.`);
    return;
  }

  if (subcommand === "remove" || subcommand === "rm") {
    const source = parts.slice(1).join(" ").trim();
    if (!source) {
      info(ctx, "Usage: /packages remove npm:pi-subagents");
      return;
    }
    const packages = await removeConfiguredPiPackage(ctx.cwd, source);
    ctx.ui.setEditorText(packageListText(packages));
    info(ctx, `Removed ${source}. Restart keating shell to unload it.`);
    return;
  }

  info(ctx, "Usage: /packages [list|recommended|add <source>|remove <source>]");
}
