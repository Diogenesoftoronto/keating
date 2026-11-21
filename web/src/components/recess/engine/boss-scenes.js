import { bossRoster } from "./boss-roster.js";

// Keep the last opening in this page's memory. A new chat flight gets a new
// engine and arena, but a rematch should still get a different entrance.
const nextOpenings = new WeakMap();
const openings = ["redaction", "footnote", "margin"];

const dialogue = {
  redaction: ["I crossed out the useful part.", "I can still see the ink."],
  footnote: ["Is that a footnote moving?", "Just wait until you meet footnote two."],
  margin: ["You're in my margin.", "That's where I do my best work."],
};

const rivalOpenings = {
  compass: {
    shot: "radius",
    secondPose: [1, 1],
    exchanges: [
      ["I draw the line here.", "Plenty of room inside your circle."],
      ["Didn't you plant that pin over there?", "I can pick it up again."],
    ],
  },
  cell: {
    shot: "seam",
    secondPose: [1, 2],
    exchanges: [
      ["Hold still. We're saving you a place.", "You can have my old spot."],
      ["Which of you goes first this time?", "Together. We rehearsed."],
    ],
  },
  metronome: {
    shot: "tempo",
    secondPose: [1, 3],
    exchanges: [
      ["Tick over here. Tock over there.", "Your hand gives you away."],
      ["Did you miss a beat?", "A rest. Watch this side again."],
    ],
  },
  carbon: {
    shot: "imprint",
    secondPose: [1, 3],
    exchanges: [
      ["I made a copy of your last three steps.", "Then you know where I was."],
      ["You put the last page first.", "I like a surprise ending."],
    ],
  },
  projector: {
    shot: "exposure",
    secondPose: [1, 2],
    exchanges: [
      ["Everybody into the light!", "I'll stand behind that slide."],
      ["One slide. Two lamps?", "Watch which one's lit."],
    ],
  },
};

// A subject sets the joke; the scene never supplies an answer to a lesson gate.
const subjectLines = {
  maths: {
    redaction: ["I've hidden all my working.", "You left a trail of equals signs."],
    footnote: ["Another page for one little footnote?", "Three pages. Small print."],
    margin: ["No room for your working here.", "There's a perfectly good margin."],
  },
  biology: {
    redaction: ["I blacked out every label.", "You missed the one on your back."],
    footnote: ["Did that label just crawl away?", "I told it to sit still."],
    margin: ["My diagram fills the whole page.", "Even the bit you're standing on?"],
  },
  coding: {
    redaction: ["I commented out the ending.", "I can read comments."],
    footnote: ["Did that footnote just call itself?", "It knows my number."],
  },
  literature: {
    footnote: ["Does the hero get a line?", "Certainly. See footnote twelve."],
    margin: ["I've written you out of this chapter.", "Check the margin."],
  },
  chemistry: { redaction: ["I inked over my entire lab book.", "Careful. It's still wet."] },
  music: { footnote: ["Was that the count-in?", "That was me warming up."] },
  business: { margin: ["My projections need another page.", "Your chart's already off the edge."] },
  history: { footnote: ["Where did you find that date?", "In a much smaller footnote."] },
  spanish: { margin: ["¡Alto! This page is mine.", "You left the margin open."] },
  french: { margin: ["Qui va là ?", "Keating. Je peux passer ?"] },
  japanese: { footnote: ["Even your footnotes have furigana?", "I like a well-labelled ambush."] },
  law: { redaction: ["I object to that margin note.", "It's your signature."] },
  politics: { margin: ["My amendment fills the page.", "I'll take the floor, then."] },
  finance: { margin: ["There's a fee for turning this page.", "Put it on my tab."] },
};

function nextOpening(G) {
  const page = G.o.arena.ownerDocument ?? G.o.arena;
  const index = nextOpenings.get(page) ?? Math.floor(G.rnd(openings.length));
  nextOpenings.set(page, (index + 1) % openings.length);
  return openings[index];
}

function shortLine(value, limit) {
  if (typeof value !== "string") return "";
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= limit ? text : "";
}

export function createBossScenes(G) {
  let scene = null;

  // Only the actor's presentation moves here. Its attack timer, hitbox tests,
  // projectiles and the rest of the world stay on the frozen simulation clock.
  function stage(progress) {
    const { boss, variant } = scene;
    const remaining = (1 - Math.min(1, progress)) ** 3;
    const side = Math.max(0, Math.min(104, G.W * 0.22, (G.W - boss.w) / 2 - 8));
    boss.x = G.W / 2; boss.y = boss.ty; boss.rot = 0;
    if (variant === "redaction") {
      boss.x += side * remaining;
    } else if (variant === "footnote") {
      boss.y -= Math.max(0, Math.min(48, boss.ty - boss.h / 2 - 5)) * remaining;
      boss.rot = -0.06 * remaining;
    } else if (variant === "margin") {
      boss.x -= side * remaining;
      boss.y += 23 * remaining;
    } else if (variant === "radius") {
      const sign = boss.bossVariant === 1 ? -1 : 1;
      boss.x += sign * side * .65 * remaining;
      boss.rot = sign * remaining * .29;
    } else if (variant === "seam") {
      boss.y += 17 * remaining;
      boss.sx = 1 - .2 * remaining;
      boss.sy = 1 + .12 * remaining;
    } else if (variant === "tempo") {
      boss.rot = .25 * remaining * Math.cos(Math.min(1, progress) * Math.PI * 1.6);
    } else if (variant === "imprint") {
      boss.y -= 15 * remaining;
      boss.sy = 1 - .12 * Math.sin(Math.min(1, progress) * Math.PI);
    } else if (variant === "exposure") {
      boss.x += (boss.bossVariant === 1 ? 1 : -1) * side * remaining;
    }
  }

  function announce() {
    const { boss, variant, bossName, variantName, lines, index, bossFirst } = scene;
    const speaker = (index === 0) === bossFirst ? "boss" : "keating";
    const rival = rivalOpenings[boss.bossId];
    if (rival) boss.bossPose = index === 0 ? 0 : rival.secondPose[boss.bossVariant ?? 0];
    G.o.bossScene({
      variant, bossName, variantName, bossId: boss.bossId ?? "wall", bossVariant: boss.bossVariant ?? 0,
      portraitPose: boss.bossPose, speaker, text: lines[index], index, total: 2,
    });
  }

  function open(boss) {
    if (!G.o.bossScene || scene || G.state !== "play") return false;
    const rival = rivalOpenings[boss.bossId];
    const variant = rival?.shot ?? nextOpening(G);
    const subject = subjectLines[G.pack.id];
    const lines = [...(rival ? rival.exchanges[boss.bossVariant ?? 0] : subject?.[variant] ?? dialogue[variant])];
    const intro = !rival && shortLine(G.pack.boss?.taunts?.intro, 60);
    const bossFirst = rival ? boss.bossVariant !== 1 : variant !== "footnote";
    if (intro) lines[bossFirst ? 0 : 1] = intro;
    const bossName = rival ? bossRoster[boss.bossId].name : shortLine(G.pack.boss?.name, 48) || G.pack.names?.wall || "Wall of Text";
    const variantName = rival ? bossRoster[boss.bossId].variants[boss.bossVariant ?? 0] : undefined;
    scene = { boss, variant, bossName, variantName, lines, bossFirst, index: 0, age: 0, lineAge: 0, manual: false };
    G.state = "cutscene";
    G.resetFlightInput();
    stage(G.calm ? 1 : 0);
    announce();
    return true;
  }

  function close(resume) {
    if (!scene) return false;
    stage(1);
    if (rivalOpenings[scene.boss.bossId]) scene.boss.bossPose = 0;
    scene = null;
    if (resume && G.state === "cutscene") {
      G.resetFlightInput();
      G.state = "play";
      G.P.inv = Math.max(G.P.inv, 0.45);
    }
    G.o.bossScene(null);
    return true;
  }

  function advance(automatic = false) {
    if (!scene || G.state !== "cutscene") return false;
    if (scene.index === 1) return close(true);
    scene.manual = !automatic;
    scene.index = 1;
    scene.lineAge = 0;
    announce();
    return true;
  }

  function tick(dt) {
    if (!scene || G.state !== "cutscene") return;
    scene.age += dt;
    stage(G.calm ? 1 : scene.age / 0.75);
    if (G.calm || scene.manual) return;
    scene.lineAge += dt;
    const readingTime = Math.max(2.2, 0.75 + scene.lines[scene.index].length / 19);
    if (scene.lineAge >= readingTime) advance(true);
  }

  return { open, tick, advance, skip: () => close(true), cancel: () => close(false) };
}
