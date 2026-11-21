// Recess weapons & companion helpers: distinct firing patterns, projectile shapes,
// orbiting/flanking Tamagotchi helpers unlocked by Power 2+ (and mid-run weapon pods).

const TAU = Math.PI * 2;

export const WEAPON_LABELS = {
  pulse: "Pulse",
  gavel: "Gavel",
  scatter: "Scatter",
  beam: "Lens Beam",
  wave: "Harmonic",
  burst: "Pipette",
  ricochet: "Bank-shot brush",
  boomerang: "Return stamp",
};

export const HELPER_LABELS = {
  drone: "Spark Drone",
  scribe: "Magnet Scribe",
  sentinel: "Sentinel Pod",
  aegis: "Aegis Prism",
};

const DROP_WEAPONS = ["scatter", "gavel", "beam", "wave", "burst", "ricochet", "boomerang"];
const CUSTOM_SHOT_SHAPES = new Set(["gavel", "beam", "wave", "burst", "helper", "ricochet", "boomerang"]);

export function pickDropWeapon(current, rnd) {
  const pool = DROP_WEAPONS.filter((w) => w !== current);
  return pool[Math.floor(rnd(pool.length))] || "scatter";
}

function makeShot(x, y, ang, speed, d, extra) {
  return Object.assign(
    {
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      ang,
      d,
      hom: false,
      pierce: false,
      kind: "pulse",
      r: 5,
      t: 0,
      hit: null,
    },
    extra,
  );
}

function makeReturnStamp(G, mx, my, aim, sweep, reach, damage) {
  const inset = 8;
  const x = G.clamp(mx, inset, G.W - inset);
  const y = G.clamp(my, inset, G.H - inset);
  const forwardX = Math.cos(aim);
  const forwardY = Math.sin(aim);
  const tipX = G.clamp(x + forwardX * reach, inset, G.W - inset);
  const tipY = G.clamp(y + forwardY * reach, inset, G.H - inset);
  const length = Math.hypot(tipX - x, tipY - y);
  return makeShot(x, y, aim, 0, damage, {
    kind: "boomerang", r: 7, pierce: true, hit: new Set(),
    originX: x, originY: y, tipX, tipY, nx: -forwardY, ny: forwardX,
    sweep: Math.sign(sweep) * Math.min(Math.abs(sweep), length * 0.28),
    duration: 0.54 + length / 650, returning: false,
  });
}

/** Fire one volley for the active weapon; returns the cadence multiplier for P.shotT. */
export function fireWeapon(G, weaponId, tier, drain, CHARGE) {
  const P = G.P;
  if (tier === 0) return 1;
  const f = P.focus;
  const a = P.aim;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  const nx = -sn;
  const ny = cs;
  const mx = P.x + cs * 30;
  const my = P.y - 6 + sn * 30;

  // The brush and stamp keep their trajectories even on the single reserve shot.
  const reserve = tier === 1;
  if (reserve && weaponId !== "ricochet" && weaponId !== "boomerang") {
    G.shots.push(makeShot(mx, my, a, 960, f ? 1.15 : 1, { kind: weaponId }));
    drain(CHARGE.cost * 0.5);
    P.fireT = 0;
    G.emit("shot", { x: mx, y: my, aim: a, power: 1, focus: f, weapon: weaponId });
    return 1;
  }

  const full = tier === 3;
  const pw = full ? P.power : 1;
  const dmg = (pw >= 4 ? 1.3 : 1) * (f ? 1.15 : 1);
  let cadence = 1;
  let costScale = full ? 1 : 0.6;

  if (weaponId === "gavel") {
    // Heavy piercing shockwave bolts: slower cadence, high impact, punches through rows.
    cadence = 1.55;
    costScale *= 1.2;
    if (pw >= 3) {
      const sp = f ? 7 : 12;
      G.shots.push(
        makeShot(mx - nx * sp, my - ny * sp, a, 760, dmg * 1.45, { kind: "gavel", pierce: true, r: 10, hit: new Set() }),
        makeShot(mx + nx * sp, my + ny * sp, a, 760, dmg * 1.45, { kind: "gavel", pierce: true, r: 10, hit: new Set() }),
      );
    } else {
      G.shots.push(makeShot(mx, my, a, 780, dmg * (pw >= 2 ? 2.1 : 1.75), { kind: "gavel", pierce: true, r: 11, hit: new Set() }));
    }
    if (pw >= 2 && ++P.vol % 2 === 0) {
      const w = f ? 0.14 : 0.28;
      G.shots.push(
        makeShot(mx, my, a - w, 860, dmg * 0.7, { kind: "pulse" }),
        makeShot(mx, my, a + w, 860, dmg * 0.7, { kind: "pulse" }),
      );
    }
  } else if (weaponId === "scatter") {
    // Wide acoustic fan; Shift focuses the cone tightly.
    cadence = 1.15;
    costScale *= 1.05;
    const count = pw >= 4 ? 7 : pw >= 2 ? 5 : 3;
    const spread = (f ? 0.055 : 0.125) * (count - 1) * 0.5;
    for (let i = 0; i < count; i++) {
      const u = count > 1 ? -1 + (2 * i) / (count - 1) : 0;
      const ang = a + u * spread;
      G.shots.push(makeShot(mx + nx * u * 6, my + ny * u * 6, ang, 900, dmg * 0.72, { kind: "scatter", r: 6 }));
    }
  } else if (weaponId === "beam") {
    // High-speed piercing prism lance(s) down the aim line.
    cadence = 1.22;
    costScale *= 1.1;
    if (pw >= 3) {
      const sp = f ? 6 : 10;
      G.shots.push(
        makeShot(mx, my, a, 1360, dmg * 1.15, { kind: "beam", pierce: true, r: 7, hit: new Set() }),
        makeShot(mx - nx * sp, my - ny * sp, a, 1320, dmg * 0.85, { kind: "beam", pierce: true, r: 6, hit: new Set() }),
        makeShot(mx + nx * sp, my + ny * sp, a, 1320, dmg * 0.85, { kind: "beam", pierce: true, r: 6, hit: new Set() }),
      );
    } else if (pw >= 2) {
      const sp = f ? 4.5 : 7.5;
      G.shots.push(
        makeShot(mx - nx * sp, my - ny * sp, a, 1340, dmg * 1.05, { kind: "beam", pierce: true, r: 6, hit: new Set() }),
        makeShot(mx + nx * sp, my + ny * sp, a, 1340, dmg * 1.05, { kind: "beam", pierce: true, r: 6, hit: new Set() }),
      );
    } else {
      G.shots.push(makeShot(mx, my, a, 1360, dmg * 1.45, { kind: "beam", pierce: true, r: 7, hit: new Set() }));
    }
  } else if (weaponId === "wave") {
    // Braided harmonic sine-wave bolts sweeping a wide corridor.
    cadence = 1.05;
    const amp = f ? 140 : 280;
    G.shots.push(
      makeShot(mx, my, a, 860, dmg * 1.05, { kind: "wave", waveAmp: amp, waveFreq: 18, wavePhase: 0, nx, ny, r: 6 }),
      makeShot(mx, my, a, 860, dmg * 1.05, { kind: "wave", waveAmp: amp, waveFreq: 18, wavePhase: Math.PI, nx, ny, r: 6 }),
    );
    if (pw >= 2) {
      G.shots.push(makeShot(mx, my, a, 940, dmg * 0.78, { kind: "pulse" }));
    }
    if (pw >= 3 && ++P.vol % 3 === 0) {
      G.shots.push(
        makeShot(P.x - nx * 18, P.y - ny * 18, a - 0.65, 520, 1.4, { hom: true, kind: "hom" }),
        makeShot(P.x + nx * 18, P.y + ny * 18, a + 0.65, 520, 1.4, { hom: true, kind: "hom" }),
      );
    }
  } else if (weaponId === "ricochet") {
    cadence = 1.4;
    const spread = f ? 0.44 : 1.06;
    const offsets = reserve ? [++P.vol % 2 ? spread : -spread] : [-spread, spread];
    if (pw >= 2) offsets.push(0);
    const x = G.clamp(mx, 5, G.W - 5);
    for (const offset of offsets) {
      G.shots.push(makeShot(x, my, a + offset, 780, dmg * 0.9, {
        kind: "ricochet", r: 5, banksLeft: pw >= 3 ? 3 : 2,
      }));
    }
  } else if (weaponId === "boomerang") {
    cadence = 2.25;
    const reach = pw >= 3 ? 350 : 280;
    const sweep = (++P.vol % 2 ? 1 : -1) * (f ? 24 : 60);
    const stampDamage = dmg * (reserve ? 0.55 : 0.92);
    G.shots.push(makeReturnStamp(G, mx, my, a, sweep, reach, stampDamage));
    if (pw >= 2) G.shots.push(makeReturnStamp(G, mx, my, a, -sweep, reach, stampDamage));
  } else if (weaponId === "burst") {
    // Rapid-fire staggered droplet stream.
    cadence = 0.64;
    costScale *= 0.7;
    const step = (++P.vol % 3) - 1;
    const sp = f ? 4 : 8;
    const jitter = step * (f ? 0.025 : 0.055);
    G.shots.push(makeShot(mx + nx * step * sp, my + ny * step * sp, a + jitter, 1040, dmg * 0.82, { kind: "burst", r: 5 }));
    if (pw >= 2) {
      G.shots.push(makeShot(mx - nx * step * sp, my - ny * step * sp, a - jitter * 0.6, 1020, dmg * 0.7, { kind: "burst", r: 5 }));
    }
    if (pw >= 3 && P.vol % 2 === 0) {
      G.shots.push(makeShot(mx, my, a, 1080, dmg * 0.75, { kind: "burst", r: 5 }));
    }
  } else {
    // Default: classic Pulse blaster.
    const sp = f ? 2.5 : 5;
    G.shots.push(
      makeShot(mx - nx * sp, my - ny * sp, a, 980, dmg, { kind: "pulse" }),
      makeShot(mx + nx * sp, my + ny * sp, a, 980, dmg, { kind: "pulse" }),
    );
    if (pw >= 2) {
      const w = f ? 0.045 : 0.15;
      G.shots.push(
        makeShot(mx - nx * (sp + 3), my - ny * (sp + 3), a - w, 980, dmg * 0.8, { kind: "pulse" }),
        makeShot(mx + nx * (sp + 3), my + ny * (sp + 3), a + w, 980, dmg * 0.8, { kind: "pulse" }),
      );
    }
    if (pw >= 3 && ++P.vol % (pw >= 4 ? 3 : 4) === 0) {
      G.shots.push(
        makeShot(P.x - nx * 18, P.y - ny * 18, a - 0.7, 520, 1.6, { hom: true, kind: "hom" }),
        makeShot(P.x + nx * 18, P.y + ny * 18, a + 0.7, 520, 1.6, { hom: true, kind: "hom" }),
      );
    }
  }

  drain(CHARGE.cost * (reserve ? 0.5 : costScale));
  P.fireT = 0;
  G.emit("shot", { x: mx, y: my, aim: a, power: pw, focus: f, weapon: weaponId });
  return cadence;
}

function advanceRicochet(G, s, dt) {
  if (s.t >= 2) { s.dead = true; return; }
  s.x = G.clamp(s.x, s.r, G.W - s.r);
  let remaining = dt;
  while (remaining > 0 && s.vx !== 0) {
    const rail = s.vx < 0 ? s.r : G.W - s.r;
    const toRail = (rail - s.x) / s.vx;
    if (toRail > remaining) break;
    s.x = rail;
    s.y += s.vy * toRail;
    remaining -= toRail;
    if (s.banksLeft === 0) { s.dead = true; return; }
    s.banksLeft--;
    s.bankAt = s.t - remaining;
    s.bankX = rail;
    s.bankY = s.y;
    s.vx = -s.vx;
  }
  s.x += s.vx * remaining;
  s.y += s.vy * remaining;
}

function advanceReturnStamp(G, s, dt) {
  const phase = Math.min(1, s.t / s.duration);
  if (phase >= 0.5 && !s.returning) {
    s.returning = true;
    s.hit.clear(); // Each foe can be stamped once on each leg.
  }
  const reach = Math.sin(Math.PI * phase);
  const curl = Math.sin(TAU * phase) * s.sweep;
  const back = Math.max(0, phase * 2 - 1);
  const catchUp = back * back * (3 - 2 * back);
  const px = s.originX + (s.tipX - s.originX) * reach + s.nx * curl + (G.P.x - s.originX) * catchUp;
  const py = s.originY + (s.tipY - s.originY) * reach + s.ny * curl + (G.P.y - s.originY) * catchUp;
  const x = G.clamp(px, s.r, G.W - s.r);
  const y = G.clamp(py, s.r, G.H - s.r);
  if (dt > 0) {
    s.vx = (x - s.x) / dt;
    s.vy = (y - s.y) / dt;
  }
  s.x = x;
  s.y = y;
  if (phase === 1) s.dead = true;
}

/** Advance a single player or helper shot. */
export function stepShot(G, s, dt) {
  s.t += dt;
  if (s.kind === "ricochet") return advanceRicochet(G, s, dt);
  if (s.kind === "boomerang") return advanceReturnStamp(G, s, dt);
  if (s.hom && G.foes.length) {
    let best = null;
    let bd = 1e9;
    for (const e of G.foes) {
      if (e.born > 0 || e.dead) continue;
      const d = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) {
      const want = Math.atan2(best.y - s.y, best.x - s.x);
      const cur = Math.atan2(s.vy, s.vx);
      let da = want - cur;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      const na = cur + G.clamp(da, -7.5 * dt, 7.5 * dt);
      s.vx = Math.cos(na) * 560;
      s.vy = Math.sin(na) * 560;
    }
  }
  if (s.kind === "wave" && s.waveAmp) {
    const osc = Math.cos(s.t * s.waveFreq + s.wavePhase) * s.waveAmp;
    s.x += (s.vx + s.nx * osc) * dt;
    s.y += (s.vy + s.ny * osc) * dt;
    return;
  }
  s.x += s.vx * dt;
  s.y += s.vy * dt;
}

function drawBrushStroke(x, s, G, outer, core) {
  x.save();
  x.translate(s.x, s.y);
  x.rotate(Math.atan2(s.vy, s.vx));
  x.fillStyle = outer;
  x.beginPath();
  x.moveTo(7, -2.8);
  x.lineTo(3, 2.8);
  x.lineTo(-8, 2.8);
  x.lineTo(-5, -2.8);
  x.closePath();
  x.fill();
  x.strokeStyle = core;
  x.lineWidth = 1.2;
  x.beginPath();
  x.moveTo(-9, -1);
  x.lineTo(2, -1);
  x.moveTo(-12, 1.4);
  x.lineTo(-4, 1.4);
  x.stroke();
  x.restore();

  if (G.calm || s.bankAt === undefined || s.t - s.bankAt >= 0.16) return;
  const sinceBank = s.t - s.bankAt;
  const inward = s.bankX < G.W / 2 ? 1 : -1;
  x.save();
  x.globalAlpha *= 1 - sinceBank / 0.16;
  x.strokeStyle = outer;
  x.lineWidth = 2;
  x.beginPath();
  x.moveTo(s.bankX + inward * 13, s.bankY - 7);
  x.lineTo(s.bankX, s.bankY);
  x.lineTo(s.bankX + inward * 13, s.bankY + 7);
  x.stroke();
  x.restore();
}

function drawReturnStamp(x, s, G, outer, core) {
  const turn = G.calm ? s.ang : s.ang + s.t * Math.sign(s.sweep) * 13;
  x.strokeStyle = outer;
  x.lineWidth = 3.3;
  x.beginPath();
  x.arc(s.x, s.y, 6.6, turn, turn + Math.PI * 1.67);
  x.stroke();
  x.strokeStyle = core;
  x.lineWidth = 1.3;
  x.beginPath();
  x.arc(s.x, s.y, 6.6, turn + 0.1, turn + Math.PI);
  x.stroke();
  if (s.returning) {
    x.fillStyle = outer;
    x.fillRect(s.x - 1.7, s.y - 1.7, 3.4, 3.4);
  }
}

/** Draw all active player and helper shots on both crisp and glow layers. */
export function drawShots(c, em, G, pal) {
  if (!G.shots.length) return;
  const dark = G.dark;
  const outerCol = dark ? pal.phos : pal.deep;
  const coreCol = dark ? "#eafff1" : pal.phos;

  for (const x of [c, em]) {
    x.lineCap = "round";

    // Standard pulse and scatter line streaks
    for (const pass of [0, 1]) {
      x.beginPath();
      for (const s of G.shots) {
        if (s.hom || CUSTOM_SHOT_SHAPES.has(s.kind)) continue;
        const len = s.kind === "scatter" ? 0.013 : 0.017;
        x.moveTo(s.x, s.y);
        x.lineTo(s.x - s.vx * len, s.y - s.vy * len);
      }
      x.strokeStyle = pass ? coreCol : outerCol;
      x.lineWidth = pass ? 1.3 : 3.6;
      x.stroke();
    }

    // Lens beam: long razor-sharp piercing prism lances
    for (const pass of [0, 1]) {
      x.beginPath();
      for (const s of G.shots) {
        if (s.kind !== "beam") continue;
        x.moveTo(s.x, s.y);
        x.lineTo(s.x - s.vx * 0.032, s.y - s.vy * 0.032);
      }
      x.strokeStyle = pass ? "#ffffff" : outerCol;
      x.lineWidth = pass ? 1.8 : 4.6;
      x.stroke();
    }

    // Gavel shockwave: bold piercing emerald chevrons
    x.strokeStyle = outerCol;
    x.lineWidth = 3.2;
    x.lineJoin = "round";
    x.beginPath();
    for (const s of G.shots) {
      if (s.kind !== "gavel") continue;
      const a = Math.atan2(s.vy, s.vx);
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const q = (u, v) => [s.x + u * cs - v * sn, s.y + u * sn + v * cs];
      const p1 = q(-6, -11);
      const p2 = q(7, 0);
      const p3 = q(-6, 11);
      x.moveTo(p1[0], p1[1]);
      x.lineTo(p2[0], p2[1]);
      x.lineTo(p3[0], p3[1]);
    }
    x.stroke();

    // Harmonic wave: diamond resonance pulses
    x.fillStyle = coreCol;
    x.strokeStyle = outerCol;
    x.lineWidth = 1.6;
    for (const s of G.shots) {
      if (s.kind !== "wave") continue;
      x.beginPath();
      x.moveTo(s.x, s.y - 5.5);
      x.lineTo(s.x + 4.5, s.y);
      x.lineTo(s.x, s.y + 5.5);
      x.lineTo(s.x - 4.5, s.y);
      x.closePath();
      x.fill();
      x.stroke();
    }

    for (const s of G.shots) {
      if (s.kind === "ricochet") drawBrushStroke(x, s, G, outerCol, coreCol);
      if (s.kind === "boomerang") drawReturnStamp(x, s, G, outerCol, coreCol);
    }

    // Pipette burst & helper mini-orbs: crisp rounded beads
    x.fillStyle = outerCol;
    for (const s of G.shots) {
      if (s.kind !== "burst" && s.kind !== "helper") continue;
      const r = s.kind === "helper" ? 3.2 : 3.8;
      x.beginPath();
      x.arc(s.x, s.y, r, 0, TAU);
      x.fill();
      x.fillStyle = coreCol;
      x.beginPath();
      x.arc(s.x, s.y, r * 0.45, 0, TAU);
      x.fill();
      x.fillStyle = outerCol;
    }

    // Homing ticks
    x.strokeStyle = outerCol;
    x.lineWidth = 2.4;
    x.lineJoin = "miter";
    x.beginPath();
    for (const s of G.shots) {
      if (!s.hom) continue;
      const a = Math.atan2(s.vy, s.vx) + Math.PI / 2;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const q = (u, v) => [s.x + u * cs - v * sn, s.y + u * sn + v * cs];
      const p1 = q(-5, 0);
      const p2 = q(-1.5, 4);
      const p3 = q(5.5, -5);
      x.moveTo(p1[0], p1[1]);
      x.lineTo(p2[0], p2[1]);
      x.lineTo(p3[0], p3[1]);
    }
    x.stroke();
  }
}

/** How far pickups are magnetized toward Keating (Magnet Scribe boosts this when active). */
export function helperMagnetScale(G) {
  if (!G.helpers || !G.helpers.length) return 1;
  return G.loadout?.helper === "scribe" ? 2.2 : 1;
}

/** Keep helper count synced with power level, move them, fire helper shots, and parry bullets (Aegis). */
export function updateHelpers(G, dt) {
  const P = G.P;
  const helperKind = G.loadout?.helper || "drone";
  const want = G.state === "play" ? Math.min(2, P.power >= 3 ? 2 : P.power >= 2 ? 1 : 0) : 0;

  while (G.helpers.length < want) {
    const idx = G.helpers.length;
    const side = idx === 0 ? -1 : 1;
    const h = {
      id: idx,
      side,
      x: P.x + side * 34,
      y: P.y + 8,
      fireT: 0.25 + idx * 0.16,
      parryCd: 0,
      flash: 0,
      born: 0,
    };
    G.helpers.push(h);
    G.emit("helperJoin", { kind: helperKind, count: G.helpers.length, x: h.x, y: h.y });
  }
  if (G.helpers.length > want) G.helpers.length = want;
  if (!G.helpers.length) return;

  const tier = G.chargeTier();
  for (let i = 0; i < G.helpers.length; i++) {
    const h = G.helpers[i];
    h.born = Math.min(1, h.born + dt * 3.5);
    h.parryCd = Math.max(0, h.parryCd - dt);
    h.flash = Math.max(0, h.flash - dt * 4);

    let tx;
    let ty;
    if (helperKind === "aegis") {
      const ang = G.T * 2.2 + i * Math.PI;
      tx = P.x + Math.cos(ang) * 44;
      ty = P.y + Math.sin(ang) * 38;
    } else {
      const spread = P.focus ? 26 : 38;
      const side = G.helpers.length === 1 ? -1 : i === 0 ? -1 : 1;
      tx = P.x + side * spread;
      ty = P.y + 8 + (G.calm ? 0 : Math.sin(G.T * 4.2 + i * 2.1) * 4);
    }
    const q = 1 - Math.exp(-dt * 14);
    h.x += (tx - h.x) * q;
    h.y += (ty - h.y) * q;

    // Aegis Prism actively intercepts nearby enemy bullets when its shield cooldown is ready.
    if (helperKind === "aegis" && h.parryCd <= 0 && G.bul.length) {
      for (const b of G.bul) {
        if (b.dead || b.safe) continue;
        const d = Math.hypot(b.x - h.x, b.y - h.y);
        if (d < (b.r || 6) + 17) {
          b.dead = true;
          h.parryCd = 1.6;
          h.flash = 1;
          G.score += 40 * G.mult;
          G.emit("parry", { x: b.x, y: b.y });
          break;
        }
      }
    }

    // Companion firing (only when Keating has firing charge).
    if (tier > 0) {
      h.fireT -= dt;
      if (h.fireT <= 0) {
        if (helperKind === "sentinel") {
          h.fireT = 0.42;
          let target = null;
          let best = 1e9;
          for (const e of G.foes) {
            if (e.dead || e.born > 0) continue;
            const d = (e.x - h.x) * (e.x - h.x) + (e.y - h.y) * (e.y - h.y);
            if (d < best) {
              best = d;
              target = e;
            }
          }
          const ang = target ? Math.atan2(target.y - h.y, target.x - h.x) : P.aim;
          G.shots.push(makeShot(h.x, h.y - 4, ang, 540, 0.72, { hom: true, kind: "hom" }));
          h.flash = 0.65;
        } else if (helperKind === "scribe") {
          h.fireT = 0.48;
          G.shots.push(makeShot(h.x, h.y - 4, P.aim, 860, 0.58, { kind: "helper" }));
          h.flash = 0.5;
        } else if (helperKind === "aegis") {
          h.fireT = 0.52;
          G.shots.push(makeShot(h.x, h.y - 4, P.aim, 860, 0.55, { kind: "helper" }));
          h.flash = 0.5;
        } else {
          // Spark Drone: nimble twin-flank fire mirroring aim.
          h.fireT = 0.36;
          G.shots.push(makeShot(h.x, h.y - 4, P.aim, 920, 0.68, { kind: "helper" }));
          h.flash = 0.6;
        }
      }
    }
  }
}

/** Draw companion helper pods flanking or orbiting Keating. */
export function drawHelpers(c, em, G, pal) {
  if (!G.helpers || !G.helpers.length) return;
  const kind = G.loadout?.helper || "drone";
  const accent = G.dark ? pal.phos : pal.deep;

  for (const h of G.helpers) {
    const scale = 0.45 + 0.55 * h.born;
    c.save();
    c.translate(h.x, h.y);
    c.scale(scale, scale);

    // Subtle hover jet
    if (!G.calm) {
      c.fillStyle = accent;
      c.globalAlpha = 0.45;
      c.beginPath();
      c.ellipse(0, 11, 3.2, 5 + Math.sin(G.T * 24 + h.id) * 1.4, 0, 0, TAU);
      c.fill();
      c.globalAlpha = 1;
    }

    // Aegis ready shield halo
    if (kind === "aegis" && h.parryCd <= 0) {
      c.strokeStyle = accent;
      c.lineWidth = 1.5;
      c.globalAlpha = 0.65;
      c.beginPath();
      c.arc(0, 0, 14, 0, TAU);
      c.stroke();
      c.globalAlpha = 1;
    }

    // Magnet Scribe subtle pull arcs
    if (kind === "scribe") {
      c.strokeStyle = accent;
      c.lineWidth = 1.3;
      c.globalAlpha = 0.55;
      c.beginPath();
      c.arc(0, 0, 13, -Math.PI * 0.75, -Math.PI * 0.25);
      c.stroke();
      c.globalAlpha = 1;
    }

    // Mini Tamagotchi pod body
    c.fillStyle = pal.card;
    c.strokeStyle = pal.ink;
    c.lineWidth = 1.6;
    if (kind === "aegis") {
      c.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU - Math.PI / 2;
        const px = Math.cos(a) * 9.5;
        const py = Math.sin(a) * 9.5;
        if (k === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.fill();
      c.stroke();
    } else {
      c.beginPath();
      c.arc(0, 0, 9, 0, TAU);
      c.fill();
      c.stroke();
    }

    // Face/lens screen inside the helper pod
    c.fillStyle = accent;
    if (kind === "sentinel") {
      c.beginPath();
      c.arc(0, -1, 3.6, 0, TAU);
      c.fill();
      c.fillStyle = pal.card;
      c.beginPath();
      c.arc(0, -1, 1.3, 0, TAU);
      c.fill();
    } else if (kind === "scribe") {
      c.fillRect(-4, -3.5, 8, 5);
      c.fillStyle = pal.card;
      c.fillRect(-2.5, -2, 5, 1.2);
      c.fillRect(-2.5, 0, 3.2, 1.2);
    } else if (kind === "aegis") {
      c.beginPath();
      c.moveTo(0, -4.5);
      c.lineTo(4, 0);
      c.lineTo(0, 4.5);
      c.lineTo(-4, 0);
      c.closePath();
      c.fill();
    } else {
      // Spark Drone: two happy pixel eyes + mini antenna
      c.strokeStyle = pal.ink;
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(0, -9);
      c.lineTo(0, -13);
      c.stroke();
      c.fillRect(-3.4, -2.5, 2.2, 3);
      c.fillRect(1.2, -2.5, 2.2, 3);
    }
    c.restore();

    if (h.flash > 0.1) {
      em.save();
      em.globalAlpha = h.flash * 0.7;
      em.fillStyle = accent;
      em.beginPath();
      em.arc(h.x, h.y, 11, 0, TAU);
      em.fill();
      em.restore();
    }
  }
}
