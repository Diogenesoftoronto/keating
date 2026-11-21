import type { RecessBossSceneBeat } from "./engine/boss-scenes.js";
import type { RecessBotArt } from "./types";
import { drawRivalActor } from "./engine/rival-art.js";

type PortraitArt = Pick<RecessBotArt, "sheet" | "rows" | "toy" | "rivalSheets">;

function drawPortrait(canvas: HTMLCanvasElement, art: PortraitArt, beat: RecessBossSceneBeat) {
  const c = canvas.getContext("2d");
  if (!c) return;
  c.clearRect(0, 0, canvas.width, canvas.height);
  const size = canvas.width;
  const { speaker, bossId } = beat;
  if (speaker === "boss" && bossId && bossId !== "wall") {
    drawRivalActor(c, { bossId, bossPose: beat.portraitPose, x: size / 2, y: size / 2, w: size * .95, h: size * .95 }, art.toy ? art.rivalSheets?.[bossId] : undefined);
    return;
  }
  if (speaker === "keating" || art.toy?.poses.wall) {
    const isPilot = speaker === "keating";
    const image = isPilot ? art.sheet : art.toy!.poses.wall;
    const cell = image.naturalWidth / (isPilot ? 8 : 4);
    const row = isPilot ? art.rows.cheer ?? art.rows.hover ?? 0 : 0;
    if (cell > 0) c.drawImage(image, 0, row * cell, cell, cell, -size * .12, -size * .09, size * 1.24, size * 1.24);
  } else if (art.toy?.box[6]) {
    const { img, cell, box } = art.toy;
    const [x, y, w, h] = box[6];
    const scale = size * .88 / Math.max(w, h);
    c.drawImage(img, cell * 2 + x, cell + y, w, h, (size - w * scale) / 2, (size - h * scale) / 2, w * scale, h * scale);
  } else {
    // The ink skin's Wall is a paragraph with two eyes.
    c.fillStyle = "#282c25";
    for (const x of [size * .36, size * .65]) {
      c.beginPath(); c.arc(x, size * .28, size * .06, 0, 2 * Math.PI); c.fill();
    }
    for (const [i, width] of [.68, .54, .65, .4].entries()) c.fillRect(size * .16, size * (.43 + i * .1), size * width, size * .038);
  }
}

/** A caption over the live game canvas. React and the offline flight share the same scene. */
export function createBossSceneView(host: HTMLElement, art: PortraitArt, actions: {
  advance(): void; skip(): void; returnFocus(): void;
}) {
  host.hidden = true;
  host.setAttribute("aria-label", "Boss introduction");
  host.setAttribute("role", "region");
  // Only fixed layout lives in this template. Lesson and director text use textContent below.
  host.innerHTML = `
    <div class="rc-shot">
      <div class="rc-marks" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="rc-crop" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <button class="rc-skip" type="button">Skip scene <span aria-hidden="true">»</span></button>
      <h2 class="rc-title"><span class="rc-name"></span><small class="rc-edition" hidden></small></h2>
    </div>
    <div class="rc-dialogue">
      <div class="rc-portrait" aria-hidden="true"><canvas width="160" height="160"></canvas></div>
      <div class="rc-caption" role="status" aria-live="polite" aria-atomic="true">
        <span class="rc-speaker"></span><p class="rc-line"></p>
      </div>
      <div class="rc-actions">
        <span class="rc-progress" aria-hidden="true"><i></i><i></i></span>
        <button class="rc-next" type="button"><span></span><b aria-hidden="true">→</b></button>
      </div>
    </div>`;
  const skip = host.querySelector<HTMLButtonElement>(".rc-skip")!;
  const next = host.querySelector<HTMLButtonElement>(".rc-next")!;
  const portrait = host.querySelector("canvas")!;
  const speaker = host.querySelector<HTMLElement>(".rc-speaker")!;
  const line = host.querySelector<HTMLElement>(".rc-line")!;
  const name = host.querySelector<HTMLElement>(".rc-name")!;
  const edition = host.querySelector<HTMLElement>(".rc-edition")!;
  skip.onclick = actions.skip;
  next.onclick = actions.advance;
  return (beat: RecessBossSceneBeat | null, calm: boolean) => {
    if (!beat) {
      const focused = host.contains(document.activeElement);
      host.hidden = true;
      if (focused) actions.returnFocus();
      return;
    }
    const opening = host.hidden;
    host.dataset.variant = beat.variant;
    host.dataset.boss = beat.bossId ?? "wall";
    host.dataset.rematch = String(beat.bossVariant ?? 0);
    host.dataset.speaker = beat.speaker;
    host.dataset.beat = String(beat.index);
    host.dataset.calm = String(calm);
    name.textContent = beat.bossName;
    edition.textContent = beat.variantName ?? "";
    edition.hidden = !beat.variantName;
    speaker.textContent = beat.speaker === "boss" ? beat.bossName : "Keating";
    line.textContent = beat.text;
    next.querySelector("span")!.textContent = beat.index + 1 === beat.total ? "Fight" : "Next";
    drawPortrait(portrait, art, beat);
    host.hidden = false;
    // Never take focus from a reader outside an embedded autoplaying flight.
    if (opening && host.parentElement === document.activeElement) next.focus({ preventScroll: true });
  };
}
