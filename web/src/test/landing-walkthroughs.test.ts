import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { availableWalkthroughs, walkthroughs } from "../components/landing-walkthroughs";

describe("landing walkthroughs", () => {
  const clip = walkthroughs[0]!;
  const paths = [clip.poster, clip.mp4, clip.webm, clip.captions, clip.guide];
  it("ships the playable recording, poster, captions and guide", () => {
    const files = paths.filter(path => existsSync(new URL("../../public" + path, import.meta.url)));
    expect(availableWalkthroughs(walkthroughs, new Set(files))).toEqual([clip]);
  });
  for (const missing of paths) {
    it("omits the recording when missing " + missing, () => {
      expect(availableWalkthroughs([clip], new Set(paths.filter(path => path !== missing)))).toEqual([]);
    });
  }
});
