import type { TuiProfile } from "../tui/profile.js";
import {
  loadTuiProfile,
  saveTuiProfile,
  tuiProfilePath,
  validateCustomAvatarPath,
} from "../tui/profile.js";

export interface ProfileCommandOptions {
  name?: string;
  image?: string;
  initials?: string;
  learner?: boolean;
}

export const PROFILE_HELP = [
  "Configure the identity shown beside your messages in Keating's TUI.",
  "",
  "Usage:",
  "  keating profile",
  "  keating profile --name=\"Ada Lovelace\" --image=./portrait.png",
  "  keating profile --name=\"Ada Lovelace\" --initials=AL",
  "  keating profile --learner",
  "",
  "Images must be local PNG, JPEG, GIF, BMP, or TIFF files no larger than 5 MiB.",
  "For the guided keyboard chooser, run `keating tui`, then type `/setup`.",
].join("\n");

function optionValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
  return value;
}

export function parseProfileCommandArgs(args: readonly string[]): { help: boolean; options: ProfileCommandOptions } {
  const help = args.includes("--help") || args.includes("-h");
  if (help) return { help: true, options: {} };
  const options: ProfileCommandOptions = {};
  const name = optionValue(args, "--name");
  const image = optionValue(args, "--image");
  const initials = optionValue(args, "--initials");
  if (name !== undefined) options.name = name;
  if (image !== undefined) options.image = image;
  if (initials !== undefined) options.initials = initials;
  if (args.includes("--learner")) options.learner = true;

  const valueOptions = new Set(["--name", "--image", "--initials"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (valueOptions.has(arg)) {
      index += 1;
      continue;
    }
    if (arg === "--learner" || [...valueOptions].some((option) => arg.startsWith(`${option}=`))) continue;
    throw new Error(`Unknown profile option: ${arg}. Run \`keating profile --help\`.`);
  }

  if (options.name !== undefined && !options.name.trim()) throw new Error("--name cannot be empty.");
  if (options.image !== undefined && !options.image.trim()) throw new Error("--image cannot be empty.");
  if (options.initials !== undefined && !options.initials.trim()) throw new Error("--initials cannot be empty.");
  const avatarChoices = Number(options.image !== undefined) + Number(options.initials !== undefined) + Number(options.learner === true);
  if (avatarChoices > 1) throw new Error("Choose only one of --image, --initials, or --learner.");
  return { help: false, options };
}

export async function configureTuiProfile(cwd: string, options: ProfileCommandOptions): Promise<TuiProfile> {
  const current = await loadTuiProfile(cwd);
  const displayName = options.name?.trim() || current.displayName;
  let avatar = current.avatar;
  if (options.image !== undefined) {
    avatar = { kind: "custom", path: await validateCustomAvatarPath(cwd, options.image) };
  } else if (options.initials !== undefined) {
    avatar = { kind: "initials", initials: options.initials };
  } else if (options.learner) {
    avatar = { kind: "learner" };
  }
  await saveTuiProfile(cwd, { schemaVersion: 1, displayName, avatar });
  return loadTuiProfile(cwd);
}

export async function runProfileCommand(cwd: string, args: readonly string[]): Promise<void> {
  const parsed = parseProfileCommandArgs(args);
  if (parsed.help) {
    console.log(PROFILE_HELP);
    return;
  }
  const hasChanges = Object.keys(parsed.options).length > 0;
  const profile = hasChanges
    ? await configureTuiProfile(cwd, parsed.options)
    : await loadTuiProfile(cwd);
  const avatar = profile.avatar.kind === "custom"
    ? `local image · ${profile.avatar.path}`
    : profile.avatar.kind === "learner"
      ? "built-in learner portrait"
      : `initials · ${profile.avatar.initials}`;
  console.log(`Keating TUI profile\n  Name: ${profile.displayName}\n  Image: ${avatar}\n  Saved: ${tuiProfilePath(cwd)}`);
  if (!hasChanges) console.log(`\n${PROFILE_HELP}`);
}
