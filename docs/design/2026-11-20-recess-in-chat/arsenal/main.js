import { RECESS_HELPERS, RECESS_WEAPONS } from "../../../../web/src/keating/habits/quest-catalog.ts";
import { createFlight } from "./flight.js";
import { RECESS_BOMBS } from "../../../../web/src/components/recess/engine/bombs.js";
import { bossRoster } from "../../../../web/src/components/recess/engine/boss-roster.js";
import { minibossRoster } from "../../../../web/src/components/recess/engine/miniboss-roster.js";
import { createBossSceneView } from "../../../../web/src/components/recess/boss-scene-view.ts";

const data = JSON.parse(document.getElementById("flight-data").textContent);
const el = (id) => document.getElementById(id);
const arena = el("arena");
const lesson = el("lesson");
const gateLayer = el("gates");
const targets = el("targets");
const answerKeys = el("answer-keys");
const media = matchMedia("(prefers-reduced-motion: reduce)");
const state = {
  subject: "maths", scene: "boss", theme: "paper", mode: "demo", range: "far",
  boss: "projector", variant: 0, mini: "clip",
  weapon: "ricochet", bomb: "sweep", helper: "aegis", power: 3, focus: false, sound: false,
  calm: media.matches, paused: media.matches, onScreen: true, temporary: "",
};
let flight, lastHud = {}, buildId = 0, repeatTimer, question, explainDone, bossBeat;
let reviewHeld = false, readingHeld = false, entranceHeld = false;

const kit = { weapon: RECESS_WEAPONS, helper: RECESS_HELPERS, bomb: Object.entries(RECESS_BOMBS).map(([bomb, item]) => ({ bomb, ...item })) };
const effects = {
  pulse: "Twin bolts. At Power 3, homing shots join the volley.",
  gavel: "Heavy chevrons punch through a row of enemies.",
  scatter: "A wide fan of bolts. Hold Shift to tighten the spread.",
  beam: "Fast, narrow rays pierce everything along their path.",
  wave: "Two braided shots sweep across neighboring lanes.",
  burst: "Short, staggered bursts of droplets.",
  ricochet: "Angle a shot into the margin and catch an enemy on the rebound.",
  boomerang: "Throw a stamp through a formation, then move to steer its return.",
  drone: "Flies on your wing and fires along your aim line.",
  scribe: "Draws distant sparks and charge cells toward you.",
  sentinel: "Tracks nearby enemies and sends homing shots after them.",
  aegis: "Orbits Keating and intercepts incoming bullets.",
};
const bombIcons = {
  eureka: "M9 4h6v2h3v7h-3v3H9v-3H6V6h3zM10 20h4M3 3l2 2m14 0 2-2",
  sweep: "M3 15h18M3 19h5m3 0h4m3 0h3M5 10l3-3 3 3m2-3 3-3 3 3",
  inkwell: "M12 2c-2 4-6 7-6 11a6 6 0 0 0 12 0c0-4-4-7-6-11zM9 14a3 3 0 0 0 3 3M3 20c5 3 13 3 18 0",
};
const kindNames = {
  oddone: "Shoot the odd one out", compare: "Compare two ideas", truefalse: "True or false",
  why: "Explain why", order: "Put steps in order", apply: "Apply the rule",
  formula: "Pick a formula", example: "Choose an example", meaning: "Find the meaning",
  cloze: "Fill the gap", swap: "Spot the mix-up", correction: "Choose the correction", name: "Name the concept",
};

function rich(node, value) {
  // Only the builder's reviewed lesson strings have markup. Learner input stays plain text.
  const markup = Object.hasOwn(data.rich, value) && data.rich[value];
  if (markup) node.innerHTML = markup;
  else node.textContent = value ?? "";
}

const heart = "M2 0h4v2h2V0h4v2h2v4h-2v2h-2v2H8v2H6v-2H4V8H2V6H0V2h2z";
const bulb = "M3 1h8v7H9v3H5V8H3zM5 13h4v1H5z";
const formatScore = new Intl.NumberFormat("en");

function drawLives(id, value, max, path, size, label) {
  const group = el(id);
  group.replaceChildren();
  group.setAttribute("aria-label", value + " " + label);
  for (let i = 0; i < max; i++) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const shape = document.createElementNS(svg.namespaceURI, "path");
    svg.setAttribute("viewBox", size);
    svg.setAttribute("aria-hidden", "true");
    if (i >= value) svg.classList.add("off");
    shape.setAttribute("d", path);
    svg.append(shape);
    group.append(svg);
  }
}

function setMeter(id, ratio) {
  const bar = el(id);
  const pct = Math.round(ratio * 100);
  if (bar.getAttribute("aria-valuenow") === String(pct)) return;
  bar.setAttribute("aria-valuenow", String(pct));
  bar.querySelector("i").style.transform = "scaleX(" + ratio + ")";
}

function syncSettings() {
  el("settings-status").textContent = "Power " + state.power + " · " + (state.theme === "paper" ? "Paper" : "Terminal");
  el("power").value = String(state.power);
  el("theme").value = state.theme;
  el("calm").checked = state.calm;
  el("calm").disabled = media.matches;
  el("focus").checked = state.focus;
  el("range-focus").setAttribute("aria-pressed", String(state.focus));
  for (const button of el("range-tools").querySelectorAll("[data-range]")) {
    button.setAttribute("aria-pressed", String(button.dataset.range === state.range));
  }
}

function hud(h) {
  if (h.range) {
    const reading = h.range.manual ? "Manual aim" : (h.range.focused ? "Focused" : "Auto-aim") + " · ±" + h.range.spreadDegrees.toFixed(1) + "°";
    if (el("range-reading").textContent !== reading) el("range-reading").textContent = reading;
  }
  if (lastHud.hearts !== h.hearts) drawLives("hearts", h.hearts, 4, heart, "0 0 14 12", "hearts");
  if (lastHud.bombs !== h.bombs) {
    drawLives("bulbs", h.bombs, 3, bulb, "0 0 14 15", "bomb charges");
    el("trigger-bomb").disabled = h.bombs <= 0;
  }
  if (lastHud.score !== h.score) el("score").textContent = formatScore.format(h.score);
  if (lastHud.mult !== h.mult) el("mult").textContent = h.mult > 1 ? "×" + h.mult : "";
  if (lastHud.charge !== h.charge) setMeter("charge", h.charge);
  if (lastHud.windSeconds !== h.windSeconds) {
    el("wind-clock").textContent = h.windSeconds > 0 ? " · " + h.windSeconds + "s" : "";
  }
  if (lastHud.boss !== h.boss) {
    el("boss-health").hidden = h.boss < 0;
    if (h.boss >= 0) setMeter("boss-health", h.boss);
  }
  if (lastHud.power !== h.power) {
    state.power = h.power;
    const pips = el("power-pips");
    pips.setAttribute("aria-label", "Power " + h.power);
    [...pips.children].forEach((pip, i) => pip.classList.toggle("on", i < h.power));
    syncSettings();
  }
  const temporary = h.weaponTemp ? kit.weapon.find(item => item.weapon === h.weapon)?.name || "" : "";
  if (temporary !== state.temporary) {
    state.temporary = temporary;
    syncMode();
  }
  const layer = !targets.hidden ? targets : gateLayer;
  if (!layer.hidden && layer.dataset.st === "1" && !answerKeys.dataset.resolved) {
    answerKeys.dataset.resolved = "true";
    const right = Number(layer.dataset.ok);
    const pick = Number(layer.dataset.pick);
    for (const [i, key] of [...answerKeys.querySelectorAll("button")].entries()) {
      key.disabled = true;
      key.toggleAttribute("data-right", i === right);
      key.toggleAttribute("data-missed", i === pick && i !== right);
      layer.children[i].toggleAttribute("data-right", i === right);
      layer.children[i].toggleAttribute("data-missed", i === pick && i !== right);
    }
    el("ask").querySelector("small").textContent = right === pick ? "Correct answer" : "Answer revealed";
  }
  lastHud = h;
}

function syncMode() {
  const landed = state.mode === "landed";
  const pilot = state.mode === "pilot";
  const chat = state.mode === "chat";
  const checking = !!bossBeat || !el("ask").hidden || !el("explain").hidden || !el("wind").hidden || reviewHeld;
  const held = state.paused || readingHeld || reviewHeld || entranceHeld;
  lesson.dataset.mode = state.mode;
  el("pause").disabled = landed || reviewHeld || !el("explain").hidden;
  el("pause").hidden = chat;
  el("pause").setAttribute("aria-pressed", String(held));
  el("pause").querySelector("span").textContent = held ? "Resume" : "Pause";
  el("land").hidden = landed;
  const rematch = el("intro-replay");
  rematch.hidden = !bossBeat;
  if (bossBeat) {
    rematch.textContent = bossBeat.bossId === "wall" ? "Another entrance" : "Try " + bossRoster[bossBeat.bossId].variants[1 - bossBeat.bossVariant];
  }
  el("range-tools").hidden = state.scene !== "range" || chat || landed;
  el("boss-tools").hidden = chat || (state.scene !== "boss" && state.scene !== "fight" && !state.scene.startsWith("mini/"));
  el("hint").hidden = !!bossBeat || !el("ask").hidden;
  el("drop").disabled = chat || landed || held || checking;
  el("trigger-bomb").hidden = landed || chat || checking;
  el("trigger-bomb").title = "Fire " + RECESS_BOMBS[state.bomb].name + " · " + RECESS_BOMBS[state.bomb].effect;
  const fly = el("fly");
  fly.hidden = checking || (pilot && !held);
  const label = landed ? "Launch again" : !pilot ? "Fly it" : "Resume flight";
  fly.querySelector("span").textContent = label;
  fly.querySelector("path").setAttribute("d", pilot && !state.paused ? "M4 2h8v7h-2v3H6V9H4zM6 14h4" : "M2 8h11M8 3l5 5-5 5");
  const hint = landed ? "Back in the lesson" : held ? "Flight paused" : state.temporary ? state.temporary + " pod equipped"
    : state.scene === "range" ? "Move closer to tighten the sight."
    : pilot ? (matchMedia("(pointer: coarse)").matches ? "Hold to focus · two-finger tap to bomb" : "Arrows to fly · Shift to focus") : "Watching the demo pilot";
  el("hint").textContent = hint;
}

function syncPause() {
  flight?.setPaused(state.paused || reviewHeld || readingHeld || entranceHeld || !state.onScreen || document.hidden);
  syncMode();
}

function updateKit(slot) {
  const selected = kit[slot].find(item => item[slot] === state[slot]);
  el(slot + "-name").textContent = selected.name;
  const blueprintCost = selected.blueprints ? selected.blueprints + " blueprints + " : "";
  if (slot !== "bomb") el(slot + "-cost").textContent = selected.parts ? blueprintCost + selected.parts + " parts" : "Starter";
  el(slot + "-effect").textContent = selected.effect || effects[selected[slot]];
}

function buildPicker(slot) {
  const group = el(slot + "s");
  for (const item of kit[slot]) {
    const id = item[slot];
    const wrap = document.createElement("label");
    wrap.className = "pick";
    wrap.title = item.name + " · " + (item.effect || effects[id]);
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = slot;
    radio.value = id;
    radio.setAttribute("aria-label", item.name);
    radio.checked = id === state[slot];
    radio.addEventListener("change", () => {
      state[slot] = id;
      updateKit(slot);
      if (slot === "weapon") flight?.setWeapon(id);
      else if (slot === "helper") flight?.setHelper(id);
      else { flight?.setBomb(id); syncMode(); }
    });
    const face = document.createElement("span");
    face.className = "piece";
    face.setAttribute("aria-hidden", "true");
    if (slot === "bomb") {
      face.classList.add("bomb-piece");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const path = document.createElementNS(svg.namespaceURI, "path");
      svg.setAttribute("viewBox", "0 0 24 24");
      path.setAttribute("d", bombIcons[id]);
      svg.append(path); face.append(svg);
    } else {
      const sprite = document.createElement("i");
      sprite.style.backgroundImage = "var(--" + item.art.sheet + ")";
      sprite.style.backgroundPosition = (item.art.cell % 4) * 100 / 3 + "% " + Math.floor(item.art.cell / 4) * 100 + "%";
      face.append(sprite);
    }
    wrap.append(radio, face);
    group.append(wrap);
  }
  updateKit(slot);
}

// Wrap each printed word at its real location so the engine can knock it loose.
function words(parent, text) {
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (!part.trim()) parent.append(part);
    else {
      const word = document.createElement("span");
      word.className = "w";
      word.textContent = part;
      parent.append(word);
    }
  }
}

function showLesson(pack) {
  el("title").textContent = pack.title;
  const topic = pack.meta.split(" · ")[0];
  el("lesson-sub").textContent = topic[0].toUpperCase() + topic.slice(1) + " · demo lesson";
  const thread = el("thread");
  thread.replaceChildren();
  for (const [index, turn] of pack.thread.entries()) {
    const line = document.createElement(turn.code ? "pre" : "p");
    line.dataset.turn = String(index);
    if (index >= 5) line.dataset.followup = "";
    line.className = turn.me ? "me" : turn.code ? "code" : "prose";
    for (const part of (turn.me || turn.code || turn.k).split(/(\{[a-z]+:[^}]+\})/)) {
      const mark = /^\{([a-z]+):([^}]+)\}$/.exec(part);
      if (!mark) words(line, part);
      else {
        const term = document.createElement("span");
        term.className = "term";
        term.dataset.foe = mark[1];
        words(term, mark[2]);
        line.append(term);
      }
    }
    thread.append(line);
  }
}

function showGate(value) {
  const ask = el("ask");
  const heldFocus = [gateLayer, targets, answerKeys].some(node => node.contains(document.activeElement));
  const targetGate = value?.kind === "oddone";
  const layer = targetGate ? targets : gateLayer;
  ask.hidden = answerKeys.hidden = !value;
  gateLayer.hidden = !value || targetGate;
  targets.hidden = !targetGate;
  el("hint").hidden = !!value;
  el("lesson-title").classList.toggle("visually-hidden", !!value);
  gateLayer.replaceChildren(); targets.replaceChildren();
  answerKeys.replaceChildren();
  delete answerKeys.dataset.resolved;
  if (heldFocus) arena.focus({ preventScroll: true });
  syncMode();
  if (!value) return;
  ask.querySelector("small").textContent = targetGate ? "Shoot or tap a target · keys 1–4" : "Fly or tap a gate · keys 1–" + value.options.length;
  ask.querySelector("strong").classList.add("rich");
  rich(ask.querySelector("strong"), value.question);
  layer.style.setProperty("--lanes", value.options.length);
  layer.dataset.st = "0";
  const label = document.createElement("span");
  label.textContent = "Answer";
  answerKeys.append(label);
  value.options.forEach((option, i) => {
    const choose = () => {
      if (flight?.answerGate(i)) el("continue-flight").focus({ preventScroll: true });
    };
    const button = document.createElement("button");
    button.type = "button";
    const key = document.createElement("kbd");
    key.textContent = String(i + 1);
    const content = document.createElement("span"); content.className = "rich";
    rich(content, option);
    button.append(key, content);
    button.addEventListener("click", choose);
    layer.append(button);
    const shortcut = document.createElement("button");
    shortcut.type = "button";
    shortcut.textContent = String(i + 1);
    const spoken = content.cloneNode(true);
    spoken.querySelectorAll("annotation").forEach(node => node.remove());
    shortcut.setAttribute("aria-label", "Answer " + (i + 1) + ", " + spoken.textContent);
    shortcut.addEventListener("click", choose);
    answerKeys.append(shortcut);
  });
}

function showWind(value, answer) {
  const wind = el("wind");
  const heldFocus = wind.contains(document.activeElement);
  wind.hidden = !value;
  const answers = wind.querySelector(".wind-answers");
  answers.replaceChildren();
  syncMode();
  if (!value) {
    if (heldFocus) arena.focus({ preventScroll: true });
    return;
  }
  rich(el("wind-q"), value.q);
  value.answers.forEach(({ t }, i) => {
    const button = document.createElement("button");
    button.type = "button";
    rich(button, t);
    button.addEventListener("click", () => {
      if (answer(i)) el("continue-flight").focus({ preventScroll: true });
    });
    answers.append(button);
  });
  if (state.mode === "pilot" && document.activeElement === arena) answers.firstElementChild?.focus({ preventScroll: true });
}

function showExplain(value, done) {
  const panel = el("explain");
  const heldFocus = panel.contains(document.activeElement);
  panel.hidden = !value;
  explainDone = done;
  el("written").value = "";
  el("written").readOnly = false;
  el("self-check").hidden = true;
  el("compare").hidden = false;
  el("compare").disabled = true;
  if (value) {
    rich(el("explain-q"), value.prompt);
    rich(el("explain-reference"), value.reference);
    if (state.mode === "pilot") el("written").focus({ preventScroll: true });
  } else if (heldFocus) arena.focus({ preventScroll: true });
  syncMode();
}

function showFeedback(result) {
  const pack = data.lessons[state.subject];
  let title, body, item;
  if (result.type === "myth") {
    title = "Misconception cleared";
    body = result.right;
    item = pack.myths.find(m => m.wrong === result.wrong);
  } else {
    title = result.type === "wind" ? (result.ok ? "Second wind · two hearts" : "Second wind missed")
      : result.ok ? "Correct · +" + formatScore.format(result.pts) : "One to revisit";
    item = [...pack.gates, ...pack.examples, ...pack.revive].find(q => q.id === result.id || q.q === result.q);
    body = result.right;
  }
  el("feedback-title").textContent = title;
  const bodyEl = el("feedback-body");
  bodyEl.replaceChildren();
  const answer = (label, text) => {
    if (label) bodyEl.append(label + " ");
    const phrase = document.createElement("span"); rich(phrase, text); bodyEl.append(phrase);
  };
  if (result.type === "myth") {
    answer("", result.wrong); bodyEl.append(document.createElement("br")); answer("Correction ·", body);
  } else {
    if (!result.ok && result.picked) { answer("Your answer ·", result.picked); bodyEl.append(document.createElement("br")); }
    answer(result.ok ? "" : "Lesson answer ·", body);
  }
  rich(el("feedback-source"), item?.source.quote);
  el("feedback-from").hidden = el("feedback-source").hidden = !item?.source;
  el("continue-flight").textContent = result.type === "wind" && !result.ok ? "Return to chat" : "Continue flight";
  el("feedback").hidden = false;
  reviewHeld = true;
  readingHeld = false;
  syncPause();
}

function dismissReview() {
  el("feedback").hidden = true;
  reviewHeld = readingHeld = false;
}

function populateEncounters(pack) {
  const menu = el("encounter");
  menu.length = 1;
  const add = (name, pairs) => {
    const group = document.createElement("optgroup"); group.label = name;
    for (const [id, label] of pairs) group.append(new Option(label, id));
    menu.append(group);
  };
  add("Lesson questions", pack.examples.map(q => [q.id, kindNames[q.kind] || q.kind]));
  add("Encounters", [["myth","Correct a misconception"], ["chain","Break the concept chain"], ["loop","Dodge the loop"],
    ["dart","Dart formation"], ["split","Splitting enemies"], ["spin","Spinning enemies"], ["drift","Drifting enemies"],
    ["fight","Wall of Text fight"], ["explain","Write an explanation"], ["wind","Answer for a second wind"]]);
  add("Chat", [["short","A chat without enough material"]]);
}

function syncBossPicker() {
  const current = bossRoster[state.boss];
  const mini = state.scene.startsWith("mini/");
  el("finale-group").setAttribute("aria-pressed", String(!mini));
  el("mini-group").setAttribute("aria-pressed", String(mini));
  el("bosses").hidden = mini;
  el("minibosses").hidden = !mini;
  for (const button of el("bosses").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.boss === current.id));
    if (button.dataset.boss === "wall" && data.toys[state.subject]) {
      button.firstElementChild.style.backgroundImage = "url(" + data.toys[state.subject].poses.wall + ")";
    }
  }
  for (const button of el("minibosses").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.mini === state.mini));
  }
  const patterns = el("boss-patterns");
  patterns.hidden = mini || current.variants.length < 2;
  for (const [index, button] of [...patterns.querySelectorAll("button")].entries()) {
    button.textContent = current.variants[index] || "";
    button.setAttribute("aria-pressed", String(index === state.variant));
  }
}

function chooseBoss(id, variant) {
  state.boss = id;
  state.variant = variant;
  el("encounter").value = "";
  startScene("boss", state.mode !== "pilot", true, true);
}

function chooseMini(id) {
  state.mini = id;
  el("encounter").value = "";
  startScene("mini/" + id, state.mode !== "pilot", true, true);
}

function buildBossPicker() {
  function addPortrait({ id, name }, mini) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset[mini ? "mini" : "boss"] = id;
    const portrait = document.createElement("i");
    portrait.setAttribute("aria-hidden", "true");
    if (id !== "wall") portrait.style.backgroundImage = "url(" + data.rivalSheets[id] + ")";
    const label = document.createElement("span");
    label.textContent = name;
    button.append(portrait, label);
    button.addEventListener("click", () => mini ? chooseMini(id) : chooseBoss(id, state.boss === id ? state.variant : 0));
    el(mini ? "minibosses" : "bosses").append(button);
  }
  const finales = new Set(["projector", "carbon", ...Object.keys(bossRoster).filter(id => id !== "wall"), "wall"]);
  for (const id of finales) addPortrait(bossRoster[id], false);
  for (const mini of Object.values(minibossRoster)) addPortrait(mini, true);
  el("finale-group").addEventListener("click", () => {
    if (state.scene.startsWith("mini/")) chooseBoss(state.boss, state.variant);
  });
  el("mini-group").addEventListener("click", () => {
    if (!state.scene.startsWith("mini/")) chooseMini(state.mini);
  });
  for (const [index, button] of [...el("boss-patterns").querySelectorAll("button")].entries()) {
    button.addEventListener("click", () => chooseBoss(state.boss, index));
  }
  el("boss-fly").addEventListener("click", () => {
    state.paused = false;
    startScene(state.scene.startsWith("mini/") ? "mini/" + state.mini : "fight", false);
    lesson.scrollIntoView({ block: "nearest", behavior: "instant" });
    arena.focus({ preventScroll: true });
  });
  syncBossPicker();
}

function end(result, { demo }) {
  const note = document.createElement("div");
  note.className = "landing-note";
  const text = [formatScore.format(result.score) + " points", result.grazes + " close calls"];
  if (result.won && result.bossName) text.unshift("Defeated " + result.bossName);
  for (const name of result.minibosses ?? []) text.push("Defeated " + name);
  if (result.gates.length) text.push(result.gates.filter(g => g.ok).length + "/" + result.gates.length + " gates answered correctly");
  note.textContent = (demo ? "Demo flight" : "Flight log") + " · " + text.join(" · ");
  if (!demo) {
    const details = document.createElement("dl");
    const row = (prompt, answer, label) => {
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      rich(dt, prompt);
      if (label) dd.append(label + " ");
      const choice = document.createElement("span"); rich(choice, answer); dd.append(choice);
      details.append(dt, dd);
    };
    for (const gate of result.gates) row(gate.q, gate.right, gate.ok ? "Got it ·" : "Review ·");
    for (const myth of result.myths) row(myth.wrong, myth.right, "Correction ·");
    if (result.wind) row(result.wind.q, result.wind.right, result.wind.ok ? "Second wind ·" : "Review ·");
    if (result.explain) {
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      rich(dt, result.explain.prompt);
      const levels = { sound: "Got it", partial: "Got part of it", missed: "Review again" };
      dd.textContent = result.explain.answer + " · Self-check · " + levels[result.explain.level];
      details.append(dt, dd);
    }
    if (details.childElementCount) note.append(details);
  }
  el("thread").append(note);
  if (demo && !result.quit) repeatTimer = setTimeout(() => startScene(state.scene, true), 1600);
  else if (document.activeElement === arena || (result.quit && document.activeElement === document.body)) {
    el("fly").focus({ preventScroll: true });
  }
}

function startScene(scene, demo, midflight = true, holdEntrance = false) {
  if (!flight) return;
  clearTimeout(repeatTimer);
  state.scene = scene;
  const mini = scene.startsWith("mini/");
  entranceHeld = holdEntrance && (scene === "boss" || mini);
  lesson.dataset.entrance = scene;
  state.temporary = "";
  el("flight-notice").textContent = "";
  el("mini-outcome").textContent = mini ? minibossRoster[state.mini].cue : "";
  el("boss-fly").textContent = mini ? "Fly this miniboss" : "Fly this fight";
  syncBossPicker();
  dismissReview();
  readingHeld = scene === "problem" || scene === "wind";
  el("thread").querySelector(".landing-note")?.remove();
  showGate(null);
  showWind(null);
  for (const button of document.querySelectorAll("[data-scene]")) {
    button.setAttribute("aria-pressed", String(button.dataset.scene === (mini || scene === "fight" ? "boss" : scene)));
  }
  const bossEncounter = scene === "boss" || scene === "fight" ? { id: state.boss, variant: state.variant } : undefined;
  flight.start(scene, { demo, midflight, question, bossEncounter });
  syncPause();
}

const loaded = new Map();
function image(src) {
  if (!loaded.has(src)) {
    const img = new Image();
    img.src = src;
    loaded.set(src, img.decode().then(() => img));
  }
  return loaded.get(src);
}

async function equipLesson(subject, holdEntrance = false) {
  const ticket = ++buildId;
  clearTimeout(repeatTimer);
  flight?.dispose();
  flight = null;
  lastHud = {};
  state.temporary = "";
  dismissReview();
  showGate(null); showWind(null); showExplain(null);
  if (subject === "short") { showShortChat(); return; }
  el("short-chat").hidden = true;
  const pack = data.lessons[subject];
  const toy = data.toys[subject];
  populateEncounters(pack);
  syncBossPicker();
  if (state.scene === "problem") {
    question = pack.examples.find(item => item.kind === question?.kind) ?? pack.examples[0];
    el("encounter").value = question.id;
  } else if ((state.scene !== "fight" || state.boss === "wall") && el("encounter").querySelector('option[value="' + state.scene + '"]')) {
    el("encounter").value = state.scene;
  }
  showLesson(pack);
  const readSheets = images => Promise.all(Object.entries(images).map(async ([name, src]) => [name, await image(src)]));
  const [sheet, fx, cast, blasters, poses, rivals] = await Promise.all([
    image(data.sheet), image(data.fx.src), image(toy.src), image(data.blasters),
    readSheets(toy.poses), readSheets(data.rivalSheets),
  ]);
  if (ticket !== buildId) return;
  const art = {
    sheet, rows: data.rows, hasJetpack: data.hasJetpack, blasters, rivalSheets: Object.fromEntries(rivals),
    flip: { img: fx, rows: data.fx.rows, cell: data.fx.cell },
    toy: { ...toy, img: cast, cast: subject, poses: Object.fromEntries(poses) },
  };
  const showScene = createBossSceneView(el("cinema"), art, {
    advance: () => {
      if (!bossBeat) return;
      const fightNow = bossBeat.index + 1 === bossBeat.total;
      entranceHeld = !fightNow;
      if (fightNow) state.paused = false;
      flight?.advanceBossScene();
      syncPause();
    },
    skip: () => { state.paused = entranceHeld = false; flight?.skipBossScene(); syncPause(); },
    returnFocus: () => arena.focus({ preventScroll: true }),
  });
  flight = createFlight({
    arena, thread: el("thread"), dock: el("dock"), bot: el("home-bot"), view: el("view"),
    shader: el("shader"), gateLayer, targetLayer: targets, pack, theme: state.theme, calm: state.calm,
    weapon: state.weapon, helper: state.helper, bombKind: state.bomb, power: state.power,
    art,
    onBossScene: beat => {
      bossBeat = beat;
      showScene(beat, state.calm);
      syncMode();
    },
    onHud: hud, onAsk: showGate, onRevive: showWind, onExplain: showExplain, onEncounterFeedback: showFeedback, onEnd: end,
    onMinibossNotice: ({ message, ended, demo }) => {
      const mini = state.scene.startsWith("mini/");
      el(mini ? "mini-outcome" : "flight-notice").textContent = (demo ? "Demo · " : "") + message;
      if (mini && ended) el("boss-fly").textContent = "Fly again";
    },
    onMode: mode => { state.mode = mode; syncMode(); },
  });
  flight.setSound(state.sound);
  flight.setFocus(state.focus);
  flight.setRange(state.range);
  startScene(state.scene, true, true, holdEntrance);
}

function switchSubject(subject, scene) {
  state.subject = subject;
  if (scene) state.scene = scene;
  el("subject").value = subject;
  equipLesson(subject).catch(report);
}

function showShortChat() {
  const sample = data.shortChat;
  state.mode = "chat";
  showLesson({ title: "What is mitosis?", meta: "biology", thread: [{ me: sample.question }, { k: sample.reply }] });
  el("lesson-sub").textContent = "Biology · sample chat";
  el("short-reason").textContent = sample.reason;
  el("draft").value = sample.draft;
  el("short-draft").hidden = el("chat-options").hidden = true;
  el("short-chat").hidden = false;
  el("encounter").value = "short";
  for (const button of document.querySelectorAll("[data-scene]")) button.setAttribute("aria-pressed", "false");
  syncMode();
}

function showChatOptions(demo) {
  const choices = el("chat-options");
  choices.replaceChildren();
  el("short-draft").hidden = true;
  choices.hidden = false;
  for (const [id, pack] of Object.entries(data.lessons)) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "tool";
    button.textContent = demo ? "Play " + pack.label : "Open " + pack.title;
    button.addEventListener("click", () => switchSubject(id, demo ? "waves" : "problem"));
    choices.append(button);
  }
  choices.firstElementChild?.focus({ preventScroll: true });
}

function report(error) {
  el("problem").hidden = false;
  el("problem").textContent = "The flight preview could not load. Reopen the standalone file to try again.";
  console.error(error);
}

document.querySelectorAll("[data-interface]").forEach(surface => {
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) surface.addEventListener(type, event => event.stopPropagation());
});
el("pause").addEventListener("click", () => {
  if (readingHeld || entranceHeld) { entranceHeld = readingHeld = false; state.paused = false; }
  else state.paused = !state.paused;
  syncPause();
  if (!state.paused) arena.focus({ preventScroll: true });
});
el("fly").addEventListener("click", () => {
  if (!flight) return;
  state.paused = readingHeld = entranceHeld = false;
  syncPause();
  if (state.mode === "landed") startScene(state.scene, false, !["waves","gates","boss"].includes(state.scene));
  else if (state.mode === "demo") flight.takeOver();
  arena.focus({ preventScroll: true });
});
el("trigger-bomb").addEventListener("click", () => {
  if (!flight) return;
  state.paused = false; syncPause();
  if (flight.bomb()) arena.focus({ preventScroll: true });
});
function land() {
  dismissReview();
  state.paused = entranceHeld = false; syncPause(); flight?.stop();
}
el("land").addEventListener("click", land);
el("intro-replay").addEventListener("click", () => {
  if (!bossBeat) return;
  chooseBoss(bossBeat.bossId, bossBeat.bossId === "wall" ? 0 : 1 - bossBeat.bossVariant);
  el("cinema").querySelector(".rc-next")?.focus({ preventScroll: true });
});
arena.addEventListener("keydown", event => {
  if (event.key === "Escape" && state.mode !== "chat" && state.mode !== "landed") { event.preventDefault(); event.stopImmediatePropagation(); land(); }
}, true);
document.querySelectorAll("[data-scene]").forEach(button => {
  button.addEventListener("click", () => {
    el("encounter").value = "";
    if (state.subject === "short") switchSubject("maths", button.dataset.scene);
    else if (button.dataset.scene === "boss") chooseBoss(state.boss, state.variant);
    else startScene(button.dataset.scene, state.mode !== "pilot");
  });
});
el("encounter").addEventListener("change", event => {
  const id = event.target.value;
  if (!id) return;
  if (id === "fight") { state.boss = "wall"; state.variant = 0; syncBossPicker(); }
  if (id === "short") { switchSubject("short"); return; }
  if (state.subject === "short") {
    question = data.lessons.maths.examples.find(q => q.id === id) ?? data.lessons.biology.examples.find(q => q.id === id);
    const topic = data.lessons.biology.examples.includes(question) ? "biology" : "maths";
    switchSubject(topic, question ? "problem" : id);
  } else {
    question = data.lessons[state.subject].examples.find(q => q.id === id);
    startScene(question ? "problem" : id, state.mode !== "pilot");
  }
});
el("continue-flight").addEventListener("click", () => {
  dismissReview(); state.paused = false; syncPause(); arena.focus({ preventScroll: true });
});
el("written").addEventListener("input", () => { el("compare").disabled = !el("written").value.trim(); });
el("compare").addEventListener("click", () => {
  if (!el("written").value.trim()) return;
  el("written").readOnly = true;
  el("compare").hidden = true;
  el("self-check").hidden = false;
  el("self-check").querySelector("button").focus({ preventScroll: true });
});
document.querySelectorAll("[data-grade]").forEach(button => button.addEventListener("click", () => {
  if (!explainDone) return;
  const answer = el("written").value.trim();
  if (!answer) return;
  explainDone(button.dataset.grade, answer);
  syncPause();
}));
el("keep-chatting").addEventListener("click", () => {
  el("chat-options").hidden = true; el("short-draft").hidden = false;
  el("draft").focus({ preventScroll: true });
});
el("another-chat").addEventListener("click", () => showChatOptions(false));
el("demo-lesson").addEventListener("click", () => showChatOptions(true));
el("power").addEventListener("change", event => {
  state.power = Number(event.target.value);
  flight?.setPower(state.power);
  syncSettings();
});
el("theme").addEventListener("change", event => {
  state.theme = event.target.value;
  lesson.dataset.theme = state.theme;
  flight?.setTheme(state.theme);
  syncSettings();
});
el("subject").addEventListener("change", event => {
  state.boss = event.target.value === "biology" ? "cell" : "compass";
  state.variant = 0;
  switchSubject(event.target.value);
});
el("calm").addEventListener("change", event => {
  state.calm = media.matches || event.target.checked;
  flight?.setCalm(state.calm);
  el("cinema").dataset.calm = String(state.calm);
});
el("sound").addEventListener("change", event => {
  state.sound = event.target.checked;
  flight?.setSound(state.sound);
});
function setFocus(value) {
  state.focus = value;
  flight?.setFocus(state.focus);
  syncSettings();
}
el("focus").addEventListener("change", event => setFocus(event.target.checked));
el("range-focus").addEventListener("click", () => setFocus(!state.focus));
for (const button of el("range-tools").querySelectorAll("[data-range]")) {
  button.addEventListener("click", () => {
    state.range = button.dataset.range;
    flight?.setRange(state.range);
    syncSettings();
  });
}
el("drop").addEventListener("click", () => flight?.dropPod());
media.addEventListener("change", () => {
  if (media.matches) {
    state.calm = state.paused = true;
    flight?.setCalm(true);
    el("cinema").dataset.calm = "true";
  }
  syncSettings();
  syncPause();
});
document.addEventListener("visibilitychange", syncPause);
if ("IntersectionObserver" in window) {
  new IntersectionObserver(([entry]) => { state.onScreen = entry.isIntersecting; syncPause(); }).observe(arena);
}

for (const name of ["blasters", "packs", "toppers"]) document.querySelector(".kit").style.setProperty("--" + name, "url(" + data[name] + ")");
el("home-bot").src = data.sit;
buildBossPicker();
buildPicker("weapon");
buildPicker("bomb");
buildPicker("helper");
syncSettings();
syncMode();
equipLesson(state.subject, true).catch(report);
