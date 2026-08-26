import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Jimp } from "jimp";

import {
  bitmapToTerminalAvatar,
  KEATINGBOT_TERMINAL_AVATAR,
  LEARNER_TERMINAL_AVATAR,
  loadTuiProfile,
  normalizeTuiProfile,
  saveTuiProfile,
  terminalAvatarForProfile,
  tuiProfilePath,
  validateCustomAvatarPath,
} from "../src/tui/profile.js";
import {
  configureTuiProfile,
  parseProfileCommandArgs,
  PROFILE_HELP,
} from "../src/cli/profile.js";
import { sacredTextWidth } from "../src/tui/sacred.js";

describe("TUI profile avatars", () => {
  test("normalizes untrusted profile fields and preserves an opaque local path", () => {
    expect(normalizeTuiProfile({
      displayName: "  Ada\nLovelace  ",
      avatar: { kind: "custom", path: " portrait.png " },
    })).toEqual({
      schemaVersion: 1,
      displayName: "Ada Lovelace",
      avatar: { kind: "custom", path: "portrait.png" },
    });
    expect(normalizeTuiProfile({ displayName: "Grace Hopper", avatar: { kind: "unknown" } })).toEqual({
      schemaVersion: 1,
      displayName: "Grace Hopper",
      avatar: { kind: "initials", initials: "GH" },
    });

    expect(normalizeTuiProfile({ displayName: "Élodie Brontë", avatar: { kind: "initials" } }).avatar.initials).toBe("ÉB");
    expect(normalizeTuiProfile({ displayName: "周 界", avatar: { kind: "initials" } }).avatar.initials).toBe("周");
    expect(normalizeTuiProfile({ displayName: "Emoji Tutor", avatar: { kind: "initials", initials: "👩‍💻X" } }).avatar.initials).toBe("👩‍💻");
    expect(sacredTextWidth(normalizeTuiProfile({
      displayName: "界".repeat(50),
      avatar: { kind: "initials" },
    }).displayName)).toBeLessThanOrEqual(80);
  });

  test("persists the profile in project-local ignored state", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-tui-profile-"));
    await saveTuiProfile(cwd, { schemaVersion: 1, displayName: "Octavia Butler", avatar: { kind: "initials", initials: "OB" } });
    expect(await loadTuiProfile(cwd)).toEqual({ schemaVersion: 1, displayName: "Octavia Butler", avatar: { kind: "initials", initials: "OB" } });
    expect(JSON.parse(await readFile(tuiProfilePath(cwd), "utf8"))).toMatchObject({ displayName: "Octavia Butler" });
  });

  test("configures every profile image choice through the standalone CLI contract", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-tui-profile-cli-"));
    const image = join(cwd, "portrait.png");
    await new Jimp({ width: 8, height: 8, color: 0x33aa66ff }).write(image);

    expect(parseProfileCommandArgs(["--name=Ada Lovelace", "--image=./portrait.png"])).toEqual({
      help: false,
      options: { name: "Ada Lovelace", image: "./portrait.png" },
    });
    expect(PROFILE_HELP).toContain("keating tui");
    expect(PROFILE_HELP).toContain("/setup");
    expect(await configureTuiProfile(cwd, { name: "Ada Lovelace", image: "./portrait.png" })).toEqual({
      schemaVersion: 1,
      displayName: "Ada Lovelace",
      avatar: { kind: "custom", path: image },
    });
    expect((await configureTuiProfile(cwd, { initials: "AL" })).avatar).toEqual({ kind: "initials", initials: "AL" });
    expect((await configureTuiProfile(cwd, { learner: true })).avatar).toEqual({ kind: "learner" });
    expect(() => parseProfileCommandArgs(["--image=a.png", "--learner"])).toThrow("Choose only one");
    expect(() => parseProfileCommandArgs(["--unknown"])).toThrow("Unknown profile option");
  });

  test("accepts bounded local images and rejects URLs and unsupported files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-tui-avatar-"));
    await mkdir(join(cwd, "images"));
    for (const extension of ["png", "jpg", "gif", "bmp", "tiff"]) {
      const path = join(cwd, "images", `portrait.${extension}`);
      await new Jimp({ width: 8, height: 8, color: 0x33aa66ff }).write(path);
      expect(await validateCustomAvatarPath(cwd, `images/portrait.${extension}`)).toBe(path);
    }
    await expect(validateCustomAvatarPath(cwd, "https://example.com/me.png")).rejects.toThrow("local files");
    await expect(validateCustomAvatarPath(cwd, "images/portrait.txt")).rejects.toThrow("support PNG");
    await writeFile(join(cwd, "images", "broken.png"), "not an image");
    await expect(validateCustomAvatarPath(cwd, "images/broken.png")).rejects.toThrow("could not be decoded");
  });

  test("rejects hostile decoded dimensions before handing bytes to Jimp", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-tui-avatar-dimensions-"));
    const encoded = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(encoded, 0);
    encoded.writeUInt32BE(13, 8);
    encoded.write("IHDR", 12, "ascii");
    encoded.writeUInt32BE(100_000, 16);
    encoded.writeUInt32BE(100_000, 20);
    await writeFile(join(cwd, "bomb.png"), encoded);

    await expect(validateCustomAvatarPath(cwd, "bomb.png")).rejects.toThrow("at most 4096 pixels");

    encoded.writeUInt32BE(3000, 16);
    encoded.writeUInt32BE(3000, 20);
    await writeFile(join(cwd, "pixel-bomb.png"), encoded);
    await expect(validateCustomAvatarPath(cwd, "pixel-bomb.png")).rejects.toThrow("at most 4194304 decoded pixels");
  });

  test("keeps every built-in and Unicode initials avatar at four terminal cells", async () => {
    const accent = await terminalAvatarForProfile(normalizeTuiProfile({
      displayName: "Élodie Brontë",
      avatar: { kind: "initials" },
    }));
    const cjk = await terminalAvatarForProfile(normalizeTuiProfile({
      displayName: "周 界",
      avatar: { kind: "initials" },
    }));
    const emoji = await terminalAvatarForProfile(normalizeTuiProfile({
      displayName: "Emoji Tutor",
      avatar: { kind: "initials", initials: "👩‍💻" },
    }));

    for (const avatar of [KEATINGBOT_TERMINAL_AVATAR, LEARNER_TERMINAL_AVATAR, accent, cjk, emoji]) {
      expect([...avatar.unicode, ...avatar.ascii].every((line) => sacredTextWidth(line) === 4)).toBe(true);
    }
  });

  test("rasterizes light-on-dark pixels into exact 4 by 2 terminal avatars", () => {
    const width = 8;
    const height = 8;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const lit = x === y || x === width - y - 1;
        data[index] = lit ? 255 : 0;
        data[index + 1] = lit ? 255 : 0;
        data[index + 2] = lit ? 255 : 0;
        data[index + 3] = 255;
      }
    }
    const avatar = bitmapToTerminalAvatar({ width, height, data });
    expect(avatar.unicode).toHaveLength(2);
    expect([...avatar.unicode[0]]).toHaveLength(4);
    expect([...avatar.unicode[1]]).toHaveLength(4);
    expect([...avatar.ascii[0]]).toHaveLength(4);
    expect(avatar.unicode.join("")).not.toBe("⠀⠀⠀⠀⠀⠀⠀⠀");
  });
});
