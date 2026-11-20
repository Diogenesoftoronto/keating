// Recess target gate (kind === "oddone"): four floating shootable targets.
// Draws cheap 2D canvas rings/reticles and drives DOM labels on o.targetLayer via CSS variables.

const ARM_TIME = 0.4;
const TIME_LIMIT = 9;
const CALM_LIMIT = 12;
const RESOLVE_HOLD = 1.35;
const SHOT_PAD = 8;

function layoutTargets(G, n) {
  const W = G.W, H = G.H, clamp = G.clamp;
  const usableH = G.floorY > H * 0.5 ? G.floorY : H;
  const r = clamp(W * 0.068, 28, 36);
  const padX = Math.max(r + 36, Math.min(W * 0.19, 130));
  const span = Math.max(0, Math.min(W - padX * 2, 740));
  const x0 = (W - span) / 2;
  const gapX = n > 1 ? span / (n - 1) : 0;

  const hudClear = usableH < 420 ? usableH * 0.28 : Math.max(150 + r, usableH * 0.3);
  const yHi = clamp(hudClear, r + 40, usableH * 0.42);
  const yGap = clamp(usableH * 0.16, 48, 104);
  const yLo = Math.max(yHi, Math.min(usableH - r - 95, yHi + yGap));
  const realGapY = Math.max(0, yLo - yHi);

  const ax = n > 1 ? clamp(Math.min(10, gapX * 0.08, Math.max(0, padX - 66)), 0, 10) : 8;
  const ay = clamp(realGapY * 0.1, 4, 9);

  const list = [];
  for (let i = 0; i < n; i++) {
    const bx = n > 1 ? x0 + (i / (n - 1)) * span : W / 2;
    const by = n > 2 ? (i % 2 === 0 ? yHi : yLo) : (yHi + yLo) * 0.5;
    list.push({
      bx, by,
      x: bx, y: G.calm ? by : by - 44,
      r,
      ax, ay,
      fx: 0.72 + i * 0.17,
      fy: 1.02 + (i % 2) * 0.24,
      phx: i * 1.57,
      phy: i * 2.09,
      flash: 0,
    });
  }
  return list;
}

function syncTargetLayer(G, Gt) {
  const layer = G.o.targetLayer;
  if (!layer) return;
  const enter = G.clamp(Gt.t / ARM_TIME, 0, 1);
  const alpha = Gt.st === 0 ? (G.calm ? 1 : enter) : 1;
  layer.dataset.st = String(Gt.st);
  layer.dataset.pick = String(Gt.pick);
  layer.dataset.ok = String(Gt.okIdx);
  layer.style.setProperty("--t-in", alpha.toFixed(3));
  for (let i = 0; i < Gt.targets.length; i++) {
    const t = Gt.targets[i];
    layer.style.setProperty("--t" + i + "-x", t.x.toFixed(1) + "px");
    layer.style.setProperty("--t" + i + "-y", t.y.toFixed(1) + "px");
  }
}

function resolveTargetGate(G, Gt, pickIdx) {
  if (Gt.st !== 0) return;
  const okIdx = Gt.okIdx;
  const right = Gt.a[okIdx] ? Gt.a[okIdx].t : "";
  const hit = pickIdx >= 0 && pickIdx < Gt.a.length;
  const picked = hit ? Gt.a[pickIdx].t : null;
  const ok = hit && Gt.a[pickIdx].ok;
  const target = hit ? Gt.targets[pickIdx] : Gt.targets[okIdx];
  const rx = target ? target.x : G.W / 2;
  const ry = target ? target.y : G.H * 0.3;

  Gt.st = 1;
  Gt.t = 0;
  Gt.pick = hit ? pickIdx : -1;
  if (hit && Gt.targets[pickIdx]) Gt.targets[pickIdx].flash = 1;
  if (!ok && Gt.targets[okIdx]) Gt.targets[okIdx].flash = 0.7;

  G.res.gates.push({ q: Gt.q, right, picked, ok, kind: Gt.kind, id: Gt.id });
  if (ok) {
    const pts = 1000 * G.mult;
    G.score += pts;
    G.P.pw += 22;
    for (let k = 0; k < 14; k++) G.addPick("s", rx + G.rnd(-45, 45), ry + G.rnd(-24, 24), true);
    G.emit("gateResolve", { ok: true, x: rx, y: ry, right, picked, pts });
  } else {
    G.emit("gateResolve", { ok: false, x: rx, y: ry, right, picked, pts: 0 });
  }
  syncTargetLayer(G, Gt);
}

export function startTargetGate(G, q, order) {
  const a = order.map((j) => ({ t: q.a[j], ok: j === 0 }));
  const Gt = {
    mode: "targets",
    q: q.q,
    kind: q.kind,
    id: q.id,
    a,
    okIdx: a.findIndex((item) => item.ok),
    st: 0,
    t: 0,
    // Time to read the question before any shot counts; shots already flying never answer it.
    arm: Math.max(ARM_TIME, 1.2),
    pick: -1,
    targets: layoutTargets(G, a.length),
  };
  for (const s of G.shots) s.preGate = true;
  syncTargetLayer(G, Gt);
  return Gt;
}

/** Answer by displayed position (number keys, buttons). */
export function answerTargetGate(G, i) {
  const Gt = G.gates;
  if (!Gt || Gt.mode !== "targets" || Gt.st !== 0 || i < 0 || i >= Gt.a.length) return false;
  resolveTargetGate(G, Gt, i);
  return true;
}

export function updateTargetGate(G, dt) {
  const Gt = G.gates;
  if (!Gt || Gt.mode !== "targets") return false;
  Gt.t += dt;
  if (Gt.st === 0 && G.bul.length) G.cancelBullets(false);

  const k = G.clamp(Gt.t / ARM_TIME, 0, 1);
  const ease = 1 - Math.pow(1 - k, 3);
  for (let i = 0; i < Gt.targets.length; i++) {
    const t = Gt.targets[i];
    if (t.flash > 0) t.flash = Math.max(0, t.flash - dt * 4.5);
    if (Gt.st === 0) {
      if (G.calm) {
        t.x = t.bx;
        t.y = t.by;
      } else {
        t.x = t.bx + Math.sin(Gt.t * t.fx + t.phx) * t.ax * ease;
        t.y = t.by - (1 - ease) * 44 + Math.sin(Gt.t * t.fy + t.phy) * t.ay * ease;
      }
    }
  }

  if (Gt.st === 0) {
    const limit = G.calm ? CALM_LIMIT : TIME_LIMIT;
    if (G.state === "play" && Gt.t >= limit) resolveTargetGate(G, Gt, -1);
  } else if (Gt.t > RESOLVE_HOLD) {
    G.gates = null;
    if (G.o.ask) G.o.ask(null);
  }
  return true;
}

export function hitTargetGate(G, s, dt) {
  const Gt = G.gates;
  if (!Gt || Gt.mode !== "targets" || Gt.st !== 0 || G.state !== "play" || Gt.t < Gt.arm || s.preGate) return false;
  const halfDt = (dt || 0) * 0.5;
  const mx = s.x - s.vx * halfDt, my = s.y - s.vy * halfDt;
  for (let i = 0; i < Gt.targets.length; i++) {
    const t = Gt.targets[i], hr = t.r + SHOT_PAD, hr2 = hr * hr;
    const dx1 = s.x - t.x, dy1 = s.y - t.y;
    const dx2 = mx - t.x, dy2 = my - t.y;
    if (dx1 * dx1 + dy1 * dy1 < hr2 || dx2 * dx2 + dy2 * dy2 < hr2) {
      resolveTargetGate(G, Gt, i);
      return true;
    }
  }
  return false;
}

function drawFallbackPill(c, x, y, text, col, fill, mono) {
  c.font = "700 12px " + mono;
  const w = Math.min(148, c.measureText(text).width + 20), h = 24, r = 5;
  const rx = x - w / 2, ry = y - h / 2;
  c.beginPath();
  c.moveTo(rx + r, ry); c.lineTo(rx + w - r, ry); c.quadraticCurveTo(rx + w, ry, rx + w, ry + r);
  c.lineTo(rx + w, ry + h - r); c.quadraticCurveTo(rx + w, ry + h, rx + w - r, ry + h);
  c.lineTo(rx + r, ry + h); c.quadraticCurveTo(rx, ry + h, rx, ry + h - r);
  c.lineTo(rx, ry + r); c.quadraticCurveTo(rx, ry, rx + r, ry); c.closePath();
  c.fillStyle = fill; c.fill();
  c.strokeStyle = col; c.lineWidth = 2; c.stroke();
  c.fillStyle = col; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(text, x, y + 0.5, w - 10);
}

export function drawTargetGate(G, c, em, pal) {
  const Gt = G.gates;
  if (!Gt || Gt.mode !== "targets") return false;
  syncTargetLayer(G, Gt);

  const TAU = G.TAU, clamp = G.clamp;
  const hasDom = Boolean(G.o.targetLayer);
  const limit = G.calm ? CALM_LIMIT : TIME_LIMIT;
  const rem = Gt.st === 0 ? clamp(1 - Gt.t / limit, 0, 1) : 0;
  const enter = Gt.st === 0 ? (G.calm ? 1 : clamp(Gt.t / ARM_TIME, 0, 1)) : 1;
  const live = Gt.st === 0 && Gt.t >= Gt.arm;

  c.lineCap = "round";
  for (let i = 0; i < Gt.targets.length; i++) {
    const t = Gt.targets[i], a = Gt.a[i];
    const isRight = a.ok, isWrongPick = Gt.st === 1 && i === Gt.pick && !isRight;
    const faded = Gt.st === 1 && !isRight && !isWrongPick;
    const pulse = Gt.st === 0 && !G.calm ? Math.sin(G.T * 3.2 + i * 1.4) * 2.2 : 0;
    const R = t.r + pulse;

    let col = pal.ink, fill = pal.card;
    if (Gt.st === 1) {
      if (isRight) { col = pal.deep; fill = pal.wash; }
      else if (isWrongPick) { col = pal.red; fill = pal.blush; }
      else { col = pal.soft; }
    }

    const baseAlpha = faded ? 0.25 : enter;

    // Soft interior disc so the reticle reads as a shootable target over the chat page.
    c.globalAlpha = baseAlpha * (isWrongPick ? 0.42 : isRight && Gt.st === 1 ? 0.48 : 0.26);
    c.fillStyle = fill;
    c.beginPath(); c.arc(t.x, t.y, R, 0, TAU); c.fill();

    // Main reticle ring.
    c.globalAlpha = baseAlpha;
    c.strokeStyle = col;
    c.lineWidth = Gt.st === 1 && isRight ? 3 : 2;
    if (Gt.st === 0 && !live) c.setLineDash([5, 5]);
    c.beginPath(); c.arc(t.x, t.y, R, 0, TAU); c.stroke();
    c.setLineDash([]);

    // Cardinal reticle ticks.
    if (!faded) {
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(t.x, t.y - R - 6); c.lineTo(t.x, t.y - R + 4);
      c.moveTo(t.x, t.y + R - 4); c.lineTo(t.x, t.y + R + 6);
      c.moveTo(t.x - R - 6, t.y); c.lineTo(t.x - R + 4, t.y);
      c.moveTo(t.x + R - 4, t.y); c.lineTo(t.x + R + 6, t.y);
      c.stroke();
    }

    // Countdown arc while active.
    if (Gt.st === 0 && rem > 0) {
      c.globalAlpha = enter * 0.65;
      c.strokeStyle = rem < 0.28 ? pal.red : pal.soft;
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(t.x, t.y, R + 6, -Math.PI / 2, -Math.PI / 2 + TAU * rem);
      c.stroke();
    }

    // Resolved right highlight ring (also glows on emissive layer).
    if (Gt.st === 1 && isRight) {
      c.globalAlpha = 0.55;
      c.strokeStyle = pal.green;
      c.lineWidth = 2;
      c.beginPath(); c.arc(t.x, t.y, R + 7, 0, TAU); c.stroke();

      em.globalAlpha = 0.7;
      em.strokeStyle = pal.phos;
      em.lineWidth = 2.4;
      em.beginPath(); em.arc(t.x, t.y, R + 2, 0, TAU); em.stroke();
    }

    // Crossed-out mark for a wrong pick.
    if (isWrongPick) {
      const d = R * 0.78;
      c.globalAlpha = 0.9;
      c.strokeStyle = pal.red;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(t.x - d, t.y - d); c.lineTo(t.x + d, t.y + d);
      c.moveTo(t.x + d, t.y - d); c.lineTo(t.x - d, t.y + d);
      c.stroke();
    }

    // Hit flash (burst disc + expanding ring).
    if (t.flash > 0.01) {
      const f = t.flash;
      const fr = R * (1 + (1 - f) * 0.5);
      c.globalAlpha = f * 0.55;
      c.fillStyle = isRight ? pal.phos : pal.blush;
      c.beginPath(); c.arc(t.x, t.y, R * (1 + (1 - f) * 0.25), 0, TAU); c.fill();

      c.globalAlpha = f * 0.9;
      c.strokeStyle = isRight ? pal.deep : pal.red;
      c.lineWidth = 2.5 * f + 0.8;
      c.beginPath(); c.arc(t.x, t.y, fr, 0, TAU); c.stroke();

      if (isRight) {
        em.globalAlpha = f * 0.8;
        em.strokeStyle = pal.phos;
        em.lineWidth = 2.5 * f + 0.8;
        em.beginPath(); em.arc(t.x, t.y, fr, 0, TAU); em.stroke();
      }
    }

    // Canvas-only fallback pill when no DOM targetLayer is supplied.
    if (!hasDom) {
      c.globalAlpha = baseAlpha;
      drawFallbackPill(c, t.x, t.y, a.t, col, fill, G.MONO);
    }
  }

  c.globalAlpha = 1;
  em.globalAlpha = 1;
  c.setLineDash([]);
  return true;
}
