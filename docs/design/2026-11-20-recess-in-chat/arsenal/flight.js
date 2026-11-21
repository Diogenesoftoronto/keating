import { Recess } from "../../../../web/src/components/recess/engine/core.js";
import { RecessArt } from "../../../../web/src/components/recess/engine/foes.js";
import { RecessAudio } from "../../../../web/src/components/recess/engine/audio.js";
import { autoAimSpread } from "../../../../web/src/components/recess/engine/aim.js";
import { pickDropWeapon, updateHelpers } from "../../../../web/src/components/recess/engine/arsenal.js";
import { RECESS_BOMBS } from "../../../../web/src/components/recess/engine/bombs.js";
import { minibossRoster } from "../../../../web/src/components/recess/engine/miniboss-roster.js";
import { RECESS_HELPERS, RECESS_WEAPONS } from "../../../../web/src/keating/habits/quest-catalog.ts";

const equipment = new Map(RECESS_WEAPONS.map(piece => [piece.weapon, piece.art.cell]));
const companions = new Set(RECESS_HELPERS.map(piece => piece.helper));
// Jump to a mark or the first matching operation in the authored wave script.
// The time is a muted preroll from launch, including the leap from the composer.
const entrances = {
  waves: ["start", 3.65], shells: ["start", 1.55], gates: ["gates", 3.15], boss: ["op/boss", 3],
  fight: ["op/boss", 3], range: ["start", 2.0],
  problem: ["gates", 8], myth: ["myth", 3.7], chain: ["op/worm", 3.5],
  loop: ["op/loop", 2.15], wind: ["start", 3], explain: ["explain", 3],
  dart: ["op/dart", 2.08], split: ["op/split", 2.7],
  spin: ["op/spin", 4.45], drift: ["op/drift", 2.8],
  ...Object.fromEntries(Object.keys(minibossRoster).map(id => ["mini/" + id, ["mini/" + id, 3]])),
};
const flightKey = /^(?:Arrow(?:Up|Down|Left|Right)|[wasdx1-4 ]|Shift)$/i;
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
const lookAhead = [.1, .28, .46];

// A two-stamp counterpart to the GPU's drifting dither. Each tile is inked
// once per palette. The two depths drift on game time, so hit-stop holds the
// page still, and Calm keeps the same paper texture without any movement.
function addPageInk(world, preview) {
  let travel = 0;
  let palette;
  let paper;
  function grain(width, height, columns, seed) {
    const tile = document.createElement("canvas");
    tile.width = width;
    tile.height = height;
    const ink = tile.getContext("2d");
    const noise = RecessArt.hash;
    ink.fillStyle = world.dark ? world.pal.phos : world.pal.ink;
    for (let col = 0; col < columns; col++) {
      const key = seed + col * 37;
      const x = Math.floor((col + noise(key)) * width / columns);
      const y = Math.floor(noise(key + 1) * height);
      const length = 8 + Math.floor(24 * noise(key + 2));
      const pitch = 3 + Math.floor(noise(key + 3) * 3);
      for (let dot = 0; dot < length; dot++) {
        if (noise(key + dot * 2.7) < .18) continue;
        ink.globalAlpha = .25 + .65 * dot / length;
        ink.fillRect(x, (y + dot * pitch) % height, 1, dot % 5 === 0 ? 2 : 1);
      }
    }
    return { pattern: world.c.createPattern(tile, "repeat"), height };
  }
  world.hook("update", dt => {
    if (!world.calm) travel += dt * (9 + 18 * world.fx.speed);
  });
  world.hook("draw.back", () => {
    if (preview.usesShader || !["intro", "play", "outro"].includes(world.state)) return;
    if (palette !== world.theme) {
      palette = world.theme;
      paper = [grain(331, 237, 19, 17), grain(257, 193, 13, 901)];
    }
    const c = world.c;
    c.save();
    c.globalCompositeOperation = "destination-over";
    for (const [index, layer] of paper.entries()) {
      if (!layer.pattern) continue;
      const offset = Math.floor(travel * (index ? 2 : .65)) % layer.height;
      c.save();
      c.translate(0, offset);
      c.fillStyle = layer.pattern;
      c.globalAlpha = world.fx.on * (index ? .105 : .075);
      c.fillRect(0, -offset, world.W, world.H);
      c.restore();
    }
    c.restore();
  });
}

// Start the sampler during a crossfire. The spinner and splitting fraction use the
// same movement, telegraphs, emitters, drops and hit tests as their authored waves.
function openingFormation(world) {
  const left = world.W * .31;
  const right = world.W * .73;
  const y = world.H * .24;
  world.spawn(world.mk("spin", left, y, {
    tx: left, ty: y, r: 22, hp: 44, pts: 500, sym: world.pack.spin,
    rot: 0, dir: 1, a: .25, cd: 0, ph: 1, pt: 0, life: 0,
  }));
  world.spawn(world.mk("split", right, y - 28, {
    vx: -21, vy: 27, cd: .12, r: 30, hp: 18, pts: 300,
    sym: world.pack.split[0], kids: world.pack.split.slice(1),
  }));
}

function stageBurstShells(world) {
  // Hold this run's opening wave until the third volley has had time to burst.
  const authoredScript = world.patterns.script;
  let resumeAt = Infinity;
  world.patterns.script = scene => {
    const waves = authoredScript(scene);
    return { step(dt) { if (world.T >= resumeAt) waves.step(dt); } };
  };

  function send(lanes) {
    for (const [index, lane] of lanes.entries()) {
      const angle = Math.PI / 2 + (lane - .5) * 1.4;
      const speed = clamp(world.H * .34, 74, 138);
      world.fire(world.W * lane, world.H * (.20 + .05 * index), angle, speed, 7, {
        fuse: (world.calm ? 2.1 : 1.65) + index * .24,
        n: world.calm ? 6 : 8, bs: world.calm ? 74 : 96, aim: true,
      });
    }
  }
  world.on("play", () => {
    const spacing = world.calm ? 3.9 : 3.25;
    resumeAt = world.T + spacing * 3;
    world.P.bombs = 3;
    world.label = "Burst shells";
    world.emit("say", { text: "Watch the fuse rings" });
    send([.32, .70]);
    world.later(spacing, () => send([.5]));
    world.later(spacing * 2, () => send([.22, .76]));
  });
}

function stageRange(world, mark) {
  const pilot = world.P;
  const radius = 12;
  let target;
  let width;
  let height;

  // Only this encounter owns the empty wave script. The practice opponent is
  // drawn by the lesson's drifter artist and hit by the normal weapon engine.
  world.patterns.script = () => ({ step() {} });
  world.kinds.range = { body: -radius };

  function place() {
    if (!target) return;
    width = world.W;
    height = world.H;
    const distance = Math.min(width, height) * (mark === "far" ? .80 : .18);
    target.x = pilot.x;
    target.y = pilot.y - distance;
    if (target.y >= 28) return;
    // After a pilot flies up to the edge, use the furthest safe corner so
    // both marks stay reachable at their actual distance on a phone.
    const dx = (pilot.x > width / 2 ? 24 : width - 24) - pilot.x;
    const dy = (pilot.y > height / 2 ? 28 : height - 28) - pilot.y;
    const scale = Math.min(1, distance / (Math.hypot(dx, dy) || 1));
    target.x = pilot.x + dx * scale;
    target.y = pilot.y + dy * scale;
  }

  world.on("play", () => {
    pilot.x = world.W / 2;
    pilot.y = world.H - clamp(world.H * .13, 42, 68);
    world.inp.tx = pilot.x;
    world.inp.ty = pilot.y;
    world.label = "Range drill";
    target = world.spawn(world.mk("range", pilot.x, pilot.y, {
      look: "drift", sym: world.pack.drift[0], r: radius, hp: 100, pts: 0,
    }));
    place();
  });
  world.on("foeHit", ({ e }) => {
    if (e === target) e.hp = e.max;
  });
  // Keep both the selected charge tier and the solitary blaster pattern
  // constant across repeated comparisons. Helpers can still ride along.
  world.on("shot", () => world.refill(world.energy0 - world.energy));
  world.hook("update", () => {
    for (const companion of world.helpers) companion.fireT = 1;
  });

  const distanceToTarget = () => Math.hypot(target.x - pilot.x, target.y - pilot.y);
  return {
    select(value) {
      mark = value;
      place();
      world.shots.length = 0;
    },
    resize() {
      if (!target || (width === world.W && height === world.H)) return;
      pilot.x = clamp(pilot.x * world.W / width, 16, world.W - 16);
      pilot.y = clamp(pilot.y * world.H / height, 26, world.H - 22);
      world.inp.tx = pilot.x;
      world.inp.ty = pilot.y;
      place();
    },
    sight() {
      if (!target || world.state !== "play") return null;
      return {
        distance: distanceToTarget(), spreadDegrees: (pilot.aimSpread || 0) * 180 / Math.PI,
        focused: !!pilot.focus, manual: !!pilot.manual,
      };
    },
    syncReticle() {
      if (!target || world.state !== "play") return;
      pilot.lock = pilot.manual ? null : target;
      pilot.aimSpread = pilot.manual ? 0 : autoAimSpread(distanceToTarget(), world.W, world.H, world.care.tune, pilot.focus);
    },
  };
}

// The reference demo chose a nearby safe spot by looking ahead along each bullet.
// Make that decision eight times a second and fly toward it at a player's speed.
function chooseWaypoint(world) {
  const { W, H, P, T } = world;
  let goalX = W * (.5 + .27 * Math.sin(T * .71));
  let goalY = H * (.71 + .055 * Math.sin(T * 1.13));
  const pod = world.picks.find(p => p.k === "w" || p.k === "e" || p.k === "h");
  if (pod) {
    goalX = pod.x;
    goalY = Math.max(H * .32, pod.y);
  }
  const gate = world.gates;
  if (gate && gate.st === 0 && gate.mode !== "targets") {
    const lane = gate.a.findIndex(answer => answer.ok);
    return { x: W * (lane + .5) / gate.a.length, y: H * .73 };
  }

  const preferred = Math.atan2(goalY - P.y, goalX - P.x);
  const reach = Math.min(52, Math.hypot(goalX - P.x, goalY - P.y));
  let lowest = Infinity;
  let waypoint = { x: P.x, y: P.y };
  for (let i = 0; i < 13; i++) {
    const radius = i === 12 ? 0 : reach;
    const angle = preferred + i * Math.PI / 6;
    const x = clamp(P.x + Math.cos(angle) * radius, 24, W - 24);
    const y = clamp(P.y + Math.sin(angle) * radius, H * .32, H - 42);
    let cost = Math.hypot(x - goalX, y - goalY) * .16;
    for (const bullet of world.bul) {
      if (bullet.dead) continue;
      const hit = world.bullets[bullet.k]?.hits;
      if (hit && hit(world, bullet, x, y)) cost += bullet.safe ? 65 : 260;
      for (const lead of lookAhead) {
        const dx = bullet.x + bullet.vx * lead - x;
        const dy = bullet.y + bullet.vy * lead - y;
        const distance2 = dx * dx + dy * dy;
        if (distance2 < 3600) cost += 1800 / (distance2 + 16);
      }
    }
    for (const foe of world.foes) {
      if (foe.dead || foe.born > 0) continue;
      if (Math.hypot(foe.x - x, foe.y - y) < foe.r + 25) cost += 130;
      cost += world.kinds[foe.k]?.threat?.(world, foe, x, y) || 0;
    }
    if (cost < lowest) {
      lowest = cost;
      waypoint = { x, y };
    }
  }
  return waypoint;
}

export function createFlight({
  arena, thread, view, dock, bot, art, pack, theme = "paper", calm = false,
  weapon = "scatter", helper = "aegis", power = 3, bombKind = "eureka",
  shader = null, gateLayer = null, targetLayer = null,
  onHud, onAsk, onRevive, onExplain, onBossScene, onEncounterFeedback, onMinibossNotice, onEnd, onMode,
}) {
  let run = null;
  let world = null;
  let sound = null;
  let mode = "landed";
  let currentScene = "waves";
  let paused = false;
  let soundWanted = false;
  let focused = false;
  let disposed = false;
  let frame = 0;
  let lastFrame = 0;
  let waypoint = null;
  let chooseAt = 0;
  let wind = null;
  let preparing = false;
  let practice = null;
  let drawnWeapon = null;
  let rangeMark = "far";
  let range = null;
  const pointers = new Set();

  function changeMode(value) {
    mode = value;
    onMode?.(value);
  }

  function resetSteering() {
    if (!world) return;
    world.resetFlightInput?.();
    for (const id of pointers) {
      if (arena.hasPointerCapture(id)) arena.releasePointerCapture(id);
    }
    pointers.clear();
    Object.assign(world.inp, {
      keys: {}, held: false, usingKeys: false, pid: null, aid: null,
      tx: world.P.x, ty: world.P.y,
    });
    if (focused && world.state === "play") {
      world.inp.keys.Shift = true;
      world.P.focus = true;
    }
    waypoint = null;
  }

  function drawKit() {
    const id = world.activeWeapon();
    if (id === drawnWeapon) return;
    drawnWeapon = id;
    // The starter gun is painted into the jetpack sheet.
    world.o.equipment.blaster = art.blasters && id !== "pulse"
      ? { image: art.blasters, cell: equipment.get(id) } : undefined;
  }

  function steer(dt) {
    if (range || mode !== "demo" || world.state !== "play") return;
    if (!waypoint || world.T >= chooseAt) {
      waypoint = chooseWaypoint(world);
      chooseAt = world.T + .12;
    }
    const dx = waypoint.x - world.P.x;
    const dy = waypoint.y - world.P.y;
    const ratio = Math.min(1, 290 * dt / (Math.hypot(dx, dy) || 1));
    world.inp.tx = world.P.x + dx * ratio;
    world.inp.ty = world.P.y + dy * ratio;
  }

  function advance(dt, paint = true) {
    steer(dt);
    if (focused && world.state === "play") world.inp.keys.Shift = true;
    if (wind && world.state === "down" && world.RT >= wind.deadline) {
      wind.answer(mode === "demo" ? wind.correct : -1);
    }
    run.preview.step(dt, paint);
  }

  function stopClock() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
  }

  function schedule() {
    if (!frame && !paused && !document.hidden && run && run.state !== "idle") {
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    frame = 0;
    const active = run;
    const elapsed = lastFrame ? now - lastFrame : 1000 / 60;
    const dt = Math.min(.034, elapsed / 1000);
    lastFrame = now;
    run.preview.govern(elapsed, dt);
    advance(dt);
    if (run === active) schedule();
  }

  function redraw() {
    if (!run || run.state === "idle") return;
    range?.syncReticle();
    run.preview.step(0);
  }

  function syncSound() {
    sound?.set(soundWanted && !paused && !document.hidden);
    if (sound?.on) sound.unlock();
  }

  function wake() {
    stopClock();
    resetSteering();
    syncSound();
    if (!document.hidden) redraw();
    schedule();
  }

  function setPaused(value) {
    if (paused === !!value) return;
    paused = !!value;
    wake();
  }

  function claimControls() {
    if (mode !== "pilot") {
      resetSteering();
      changeMode("pilot");
      if (wind) wind.deadline = wind.manualDeadline;
    }
  }

  function takeOver() {
    if (!run || !["intro", "play", "down", "pause"].includes(run.state)) return false;
    claimControls();
    setPaused(false);
    arena.focus({ preventScroll: true });
    return true;
  }

  function answerGate(index) {
    const gate = world?.gates;
    if (!gate || gate.st !== 0 || run.state !== "play" || document.hidden ||
        !Number.isInteger(index) || index < 0 || index >= gate.a.length) return false;
    claimControls();
    const accepted = run.answerGate(index);
    if (accepted) redraw();
    return accepted;
  }

  // These listeners precede the engine bindings. UI overlays keep their own
  // pointer and keyboard events; a casual hover never steers the demo away.
  function gateInput(event) {
    const control = event.target !== arena && event.target.closest?.("[data-interface],button,input,select,textarea,summary,a");
    const keyEvent = event.type === "keydown" || event.type === "keyup";
    const demoHover = mode === "demo" && event.type === "pointermove" && !pointers.has(event.pointerId);
    if (control || document.hidden || demoHover) {
      event.stopImmediatePropagation();
      return;
    }
    if (paused) {
      if (event.type === "keydown" && event.target === arena && /^[1-4]$/.test(event.key) &&
          !event.altKey && !event.ctrlKey && !event.metaKey && answerGate(Number(event.key) - 1)) event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!run || run.state === "idle") return;
    const movement = keyEvent && event.target === arena && flightKey.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (mode === "demo" && (event.type === "pointerdown" || (event.type === "keydown" && movement))) takeOver();
    if (event.type === "pointerdown") pointers.add(event.pointerId);
    if (["pointerup", "pointercancel", "lostpointercapture"].includes(event.type)) pointers.delete(event.pointerId);
  }
  const inputs = ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture", "keydown", "keyup"];
  for (const type of inputs) arena.addEventListener(type, gateInput);
  document.addEventListener("visibilitychange", wake);

  function refreshGeometry() {
    if (!run || run.state === "idle") return;
    run.preview.resize();
    range?.resize();
    const field = arena.getBoundingClientRect();
    for (const word of world.words) {
      const rect = word.el.getBoundingClientRect();
      word.hx = rect.left - field.left + rect.width / 2;
      word.hy = rect.top - field.top + rect.height / 2;
      word.w = rect.width;
      word.h = rect.height;
    }
    redraw();
  }
  const observer = new ResizeObserver(refreshGeometry);
  observer.observe(arena);

  function secondWind(value, answer) {
    wind = null;
    if (!value) { onRevive?.(null); return; }
    const activeRun = run;
    const manualDeadline = value.seconds ? world.RT + value.seconds : Infinity;
    const resolve = index => {
      if (activeRun !== run || run.state !== "down" || !wind) return false;
      wind = null;
      onRevive?.(null);
      answer(index);
      if (!preparing && mode === "pilot") {
        practice.wind = world.res.wind;
        onEncounterFeedback?.({ type: "wind", ...practice.wind });
      }
      redraw();
      return true;
    };
    wind = {
      deadline: mode === "demo" ? world.RT + 2.4 : manualDeadline,
      manualDeadline, answer: resolve, correct: value.answers.findIndex(choice => choice.ok),
    };
    onRevive?.(value, index => {
      if (activeRun !== run || run.state !== "down" || document.hidden ||
          !Number.isInteger(index) || index < 0 || index >= value.answers.length) return false;
      claimControls();
      return resolve(index);
    });
  }

  function explain(value, grade) {
    if (!value) { onExplain?.(null); return; }
    const activeRun = run;
    onExplain(value, (level, answer) => {
      if (run !== activeRun || run.state !== "pause" || document.hidden ||
          !["sound", "partial", "missed"].includes(level) || typeof answer !== "string") return false;
      claimControls();
      grade(level, answer);
      practice.explain = world.res.explain;
      onExplain(null);
      redraw();
      return true;
    });
  }

  function releaseRun() {
    stopClock();
    resetSteering();
    run?.dispose();
    // The renderer releases its WebGL context on disposal. A new canvas lets
    // the next scene or lesson acquire a fresh context on hardware renderers.
    if (run && shader?.parentNode) {
      const fresh = shader.cloneNode(false);
      shader.replaceWith(fresh);
      shader = fresh;
    }
    run = world = sound = wind = range = null;
    drawnWeapon = null;
    onAsk?.(null);
    onRevive?.(null);
    onExplain?.(null);
  }

  function applyPower() {
    world.P.power = power;
    world.P.pw = world.PW[power - 1];
  }

  function startBossWarning() {
    const boss = world.boss;
    if (!boss || boss.stage >= 0) return;
    boss.y = boss.ty;
    world.kinds[boss.k].update(world, boss, 0);
  }

  function start(scene = "waves", { demo = true, midflight = true, question, bossEncounter } = {}) {
    if (disposed) return false;
    if (world) power = world.P.power;
    releaseRun();
    currentScene = scene;
    chooseAt = 0;
    practice = { gates: [], myths: [], wind: null, explain: null, minibosses: [] };
    const lesson = scene === "problem" && question
      ? { ...pack, gates: [question, ...(pack.gates || []).filter(item => item.q !== question.q)].slice(0, 4) } : pack;
    const [entrance, seconds] = Object.hasOwn(entrances, scene) ? entrances[scene] : entrances.waves;
    const mini = entrance.startsWith("mini/");
    const practiceFinale = entrance === "op/boss";
    sound = RecessAudio.create();
    run = Recess.create({
      arena, thread, view, dock, bot, shader, gateLayer, targetLayer, pack: lesson, bombKind, bossEncounter,
      sheet: art.sheet, rows: art.rows, hasJetpack: art.hasJetpack,
      flip: art.flip, toy: art.toy, rivalSheets: art.rivalSheets, equipment: { ...art.equipment },
      theme, calm, control: "follow", sound, loadout: { weapon, helper },
      hud(value) {
        if (wind && Number.isFinite(wind.manualDeadline)) {
          value.windSeconds = Math.ceil(Math.max(0, wind.manualDeadline - world.RT));
        }
        const sight = range?.sight();
        if (sight) value.range = sight;
        onHud?.(value);
      },
      // A direct fight takes the production scene's Skip path before its first paint.
      bossScene: scene === "fight" ? () => {} : onBossScene,
      practiceFinale, settingPracticeKit: () => preparing && (mini || practiceFinale),
      minibossNotice(message) {
        if (!preparing) onMinibossNotice?.({ message, ended: !world.miniboss, demo: mode === "demo" });
      },
      ask: onAsk, revive: secondWind, explain: onExplain ? explain : undefined,
      end(result) {
        const finished = { demo: mode === "demo", scene: currentScene };
        stopClock();
        changeMode("landed");
        // The arcade keeps its running score. Only reader-owned practice appears
        // in their recap when they take the controls halfway through a demo.
        const care = { ...result.care, cogs: practice.gates.filter(gate => gate.ok).length };
        onEnd?.(finished.demo ? result : { ...result, ...practice, care }, finished);
      },
    });
    world = run.preview.world;
    addPageInk(world, run.preview);
    world.hook("update", drawKit);
    world.on("gateResolve", ({ pts }) => {
      if (preparing || mode !== "pilot") return;
      const result = world.res.gates[world.res.gates.length - 1];
      practice.gates.push(result);
      onEncounterFeedback?.({ type: "gate", ...result, pts });
    });
    world.on("mythStruck", ({ myth }) => {
      if (preparing) return;
      if (mode === "pilot") practice.myths.push(myth);
      onEncounterFeedback?.({ type: "myth", ...myth, demo: mode === "demo" });
    });
    world.on("minibossEnd", ({ name, defeated }) => {
      if (!preparing && mode === "pilot" && defeated) practice.minibosses.push(name);
    });
    if (midflight && scene === "waves") world.on("play", () => openingFormation(world));
    if (scene === "shells") stageBurstShells(world);
    if (scene === "range") range = stageRange(world, rangeMark);
    if (scene === "wind") world.on("play", () => {
      // Enter the engine's normal last-hit window with one heart and let it land.
      world.P.hearts = 1;
      world.hitPlayer();
    });
    const reading = scene === "problem" || scene === "wind" || scene === "explain";
    changeMode(demo && !reading ? "demo" : "pilot");
    run.start(entrance);
    run.preview.ownClock();
    applyPower();
    drawKit();
    if (midflight) {
      // Fast-forward real physics with sound muted. Paint only the settled
      // frame, so reduced-motion users also get a complete still to inspect.
      preparing = true;
      const holdFire = mini || entrance.startsWith("op/") || scene === "myth" || scene === "problem";
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        // Show the chosen opponent before a high-power volley can destroy it.
        // On a target gate, the first shot belongs to the visible flight too.
        if (holdFire) {
          world.P.shotT = Math.max(world.P.shotT, .10);
          for (const helper of world.helpers) helper.fireT = Math.max(helper.fireT, .10);
        }
        advance(1 / 60, false);
        if ((mini || practiceFinale) && world.state === "play") {
          // The bot has just finished its launch. Cue the actual spawn before
          // the first combat tick so no shot, reward or warning time is spent.
          updateHelpers(world, 0);
          run.preview.cueScript();
          if (scene === "fight") {
            const launchGrace = world.P.inv;
            run.skipBossScene();
            // Direct practice keeps the pilot's launch invulnerability and opacity.
            world.P.inv = launchGrace;
            startBossWarning();
          }
          break;
        }
        if (world.state === "cutscene" || world.state === "down" || world.state === "pause") break;
        const gate = world.gates;
        if (scene === "problem" && gate) {
          // All four targets are readable before any in-flight shot can answer.
          if (gate.mode === "targets" ? gate.t + 1 / 60 >= gate.arm
            : gate.y >= Math.min(world.H * .38, world.P.y - 48)) break;
        }
      }
      preparing = false;
    }
    redraw();
    syncSound();
    schedule();
    return true;
  }

  return {
    start, takeOver, setPaused, answerGate,
    setRange(value) {
      if (value !== "near" && value !== "far") return;
      rangeMark = value;
      range?.select(value);
      redraw();
    },
    advanceBossScene() {
      if (document.hidden || !run?.advanceBossScene()) return false;
      if (run.state === "play") {
        claimControls();
        if (currentScene === "boss") startBossWarning();
      }
      redraw();
      return true;
    },
    skipBossScene() {
      if (document.hidden || !run?.skipBossScene()) return false;
      if (currentScene === "boss") startBossWarning();
      redraw();
      return true;
    },
    setWeapon(id) {
      if (!equipment.has(id)) return;
      weapon = id;
      if (!world) return;
      world.loadout.weapon = id;
      world.tempWeapon = null;
      world.tempWeaponT = 0;
      drawKit();
      redraw();
    },
    setHelper(id) {
      if (!companions.has(id)) return;
      helper = id;
      if (world) { world.loadout.helper = id; redraw(); }
    },
    setPower(value) {
      if (!Number.isInteger(value) || value < 1 || value > 4) return;
      power = value;
      if (!world) return;
      applyPower();
      if (world.state === "play") updateHelpers(world, 0);
      redraw();
    },
    setFocus(value) {
      focused = !!value;
      if (!world) return;
      world.inp.keys.Shift = focused && world.state === "play";
      world.P.focus = world.state === "play" && (focused || world.inp.held);
      redraw();
    },
    dropPod() {
      if (world?.state !== "play" || world.picks.some(p => p.k === "w")) return false;
      const x = clamp(world.P.x + (world.P.x < world.W / 2 ? 74 : -74), 30, world.W - 30);
      const y = Math.max(44, world.P.y - 160);
      const pod = world.addPick("w", x, y);
      pod.weapon = pickDropWeapon(world.activeWeapon(), world.rnd);
      redraw();
      return true;
    },
    setBomb(id) {
      if (!Object.hasOwn(RECESS_BOMBS, id)) return;
      bombKind = id;
      if (world) world.bombKind = id;
    },
    bomb() {
      if (paused || world?.state !== "play") return false;
      const reserve = world.P.bombs;
      run.bomb();
      redraw();
      return world.P.bombs < reserve;
    },
    setCalm(value) { calm = !!value; run?.setCalm(calm); redraw(); },
    setTheme(value) {
      if (!Object.hasOwn(RecessArt.PAL, value)) return;
      theme = value;
      if (!world) return;
      world.theme = value;
      world.dark = value === "term";
      world.pal = RecessArt.PAL[value];
      for (const word of world.words) word.col = getComputedStyle(word.el).color;
      redraw();
    },
    setSound(value) { soundWanted = !!value; syncSound(); },
    stop() {
      if (!run || run.state === "idle") return;
      setPaused(false);
      run.stop();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", wake);
      for (const type of inputs) arena.removeEventListener(type, gateInput);
      releaseRun();
    },
  };
}
