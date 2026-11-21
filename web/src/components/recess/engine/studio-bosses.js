// Carbon's paper impressions and Limelight's shadow are shared by the ink on
// the field, the hit test and the practice pilot. World coordinates are CSS px.
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const SAMPLE_INTERVAL = .55;

function recordImpression(G, e) {
  const { halfW, halfH, marks } = e.proof;
  const sample = { x: G.P.x, y: G.P.y };
  const overlaps = (x, y) => marks.some(mark =>
    Math.abs(mark.x - x) < 2 * halfW + 5 && Math.abs(mark.y - y) < 2 * halfH + 5);
  let x = sample.x, y = sample.y;
  if (overlaps(x, y)) {
    // A carbon sheet slips sideways when the pilot holds still. Its registration
    // dot stays on the real sample and the displaced outline is visible immediately.
    const horizontal = (x < G.W / 2 ? 1 : -1) * (2 * halfW + 12);
    const vertical = (y < G.H / 2 ? 1 : -1) * (2 * halfH + 12);
    for (const [dx, dy] of [[horizontal, 0], [0, vertical], [-horizontal, 0], [0, -vertical], [horizontal, vertical]]) {
      const cx = clamp(sample.x + dx, halfW + 2, G.W - halfW - 2);
      const cy = clamp(sample.y + dy, halfH + 2, G.H - halfH - 2);
      if (!overlaps(cx, cy)) { x = cx; y = cy; break; }
    }
  }
  marks.push({ x, y, sample });
}

function prepareCarbon(G, e, beat) {
  if (beat) return;
  const halfW = clamp(Math.min(G.W, G.H) * .079, 23, 38);
  e.proof = { halfW, halfH: halfW * .72, marks: [], order: e.bossVariant ? [2, 1, 0] : [0, 1, 2] };
  recordImpression(G, e);
}

function stampDistance(proof, mark, x, y) {
  return Math.max(Math.abs(x - mark.x) - proof.halfW, Math.abs(y - mark.y) - proof.halfH);
}

function updateCarbon(G, e) {
  const proof = e.proof;
  if (e.phase === "warn" && e.beat === 0 && proof.marks.length < 3) {
    if (e.age >= proof.marks.length * SAMPLE_INTERVAL) recordImpression(G, e);
  }
  return e.phase === "strike" && stampDistance(proof, proof.marks[proof.order[e.beat]], G.P.x, G.P.y) <= 3;
}

function carbonThreat(G, e, x, y) {
  const proof = e.proof;
  const next = proof.marks[proof.order[e.beat]];
  if (!next) return 0;
  return Math.max(0, 31 - stampDistance(proof, next, x, y)) * 5;
}

function drawCarbon(G, e, c, p) {
  const { halfW, halfH, marks, order } = e.proof;
  const live = e.phase === "strike", active = order[e.beat];
  c.textAlign = "center"; c.textBaseline = "middle"; c.font = "bold 13px " + G.MONO;
  for (const [i, mark] of marks.entries()) {
    if (order.indexOf(i) < e.beat) continue;
    const current = i === active, x = mark.x, y = mark.y;
    if (x !== mark.sample.x || y !== mark.sample.y) {
      c.strokeStyle = p.ink; c.lineWidth = 1; c.setLineDash([2, 4]);
      c.beginPath(); c.moveTo(mark.sample.x, mark.sample.y); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
      c.fillStyle = p.ink; c.fillRect(mark.sample.x - 2, mark.sample.y - 2, 4, 4);
    }
    c.save(); c.globalAlpha *= current && live ? .38 : .12;
    c.fillStyle = current ? p.red : p.soft; c.fillRect(x - halfW, y - halfH, halfW * 2, halfH * 2); c.restore();
    c.strokeStyle = current ? p.red : p.ink; c.lineWidth = current ? 3 : 1.4;
    c.setLineDash(current && !live ? [7, 4] : []);
    c.strokeRect(x - halfW, y - halfH, halfW * 2, halfH * 2); c.setLineDash([]);
    if (current && live) {
      for (let n = -1; n <= 1; n++) {
        c.beginPath(); c.moveTo(x + n * halfW * .46 - 5, y + halfH - 4);
        c.lineTo(x + n * halfW * .46 + 5, y + halfH - 11); c.stroke();
      }
    }
    // Keep the number clear of the bot, its helpers and the chat's letters.
    const tabX = clamp(x - halfW + 9, 9, G.W - 9), tabY = clamp(y - halfH + 9, 9, G.H - 9);
    c.fillStyle = current ? p.red : p.ink; c.fillRect(tabX - 7, tabY - 7, 14, 14);
    c.fillStyle = p.paper; c.fillText(String(i + 1), tabX, tabY + .5);
  }
  // The same sequence is visible above the press when the finger covers a mark.
  const top = Math.max(16, e.y - e.h * .47);
  for (const [slot, index] of order.entries()) {
    const x = e.x + (slot - 1) * 21, activeSlot = slot === e.beat;
    c.fillStyle = activeSlot ? p.red : p.paper; c.fillRect(x - 8, top - 8, 16, 16);
    c.strokeStyle = p.ink; c.lineWidth = 1.5; c.strokeRect(x - 8, top - 8, 16, 16);
    c.fillStyle = activeSlot ? p.paper : p.ink; c.fillText(String(index + 1), x, top + .5);
  }
}

function penumbra(beam, y) {
  const scale = (y - beam.lensY) / (beam.slideY - beam.lensY);
  return { center: beam.lensX + (beam.slideX - beam.lensX) * scale, half: beam.slideHalf * scale };
}

function coverCaption(G, beam) {
  // All four corners must clear the light. In a very wide, shallow field
  // a sideways shadow can only take a plate angled along the ray.
  const ray = Math.atan((beam.slideY - beam.lensY) / (beam.slideX - beam.lensX));
  for (const [scale, angle] of [[1, 0], [.8, 0], [1, ray], [.8, ray], [.6, ray], [.5, ray]]) {
    const cos = Math.cos(angle) * scale, sin = Math.sin(angle) * scale;
    const corners = [[-25, -9], [25, -9], [-25, 9], [25, 9]].map(([x, y]) =>
      ({ x: x * cos - y * sin, y: x * sin + y * cos }));
    const halfH = Math.abs(25 * sin) + Math.abs(9 * cos);
    for (let y = beam.slideY + 7 + halfH; y + halfH < G.H; y += 5) {
      let left = -Infinity, right = Infinity;
      for (const corner of corners) {
        const band = penumbra(beam, y + corner.y);
        left = Math.max(left, Math.max(1, band.center - band.half) - corner.x);
        right = Math.min(right, Math.min(G.W - 1, band.center + band.half) - corner.x);
      }
      if (left <= right) return { x: clamp(penumbra(beam, y).center, left, right), y, scale, angle };
    }
  }
}

function prepareProjector(G, e, beat) {
  if (beat === 0) {
    const towardMiddle = G.P.x < G.W / 2 ? 1 : -1;
    const lensY = e.ty + e.h * .08;
    const row = clamp(G.P.y, Math.max(G.H * .52, lensY + 72), G.H - 25);
    const slideHalf = Math.min(G.W * .14, clamp(Math.min(G.W, G.H) * .09, 30, 47) * (G.calm ? 1.13 : 1));
    const shelterX = clamp(G.P.x + towardMiddle * (slideHalf * 2 + 39), 18, G.W - 18);
    // The slide is halfway to the pilot's row. Swing the second shadow toward
    // the middle of the page so both shelters are reachable from either margin.
    const swing = shelterX < G.W / 2 ? 1 : -1;
    const travel = e.bossVariant ? Math.min(G.W * .31, 140, Math.max(G.W * .22, slideHalf * 2 + 18)) : 0;
    const lensX = G.W / 2 + swing * travel / 2;
    e.beam = { lensX, lensY, otherX: lensX - swing * travel,
      slideX: (lensX + shelterX) / 2, slideY: (lensY + row) / 2, slideHalf, row };
  } else {
    e.beam.lensX = e.beam.otherX;
  }
  const beam = e.beam;
  e.x = beam.lensX;
  e.cover = coverCaption(G, beam);
  const destination = penumbra(beam, beam.row);
  const distance = Math.hypot(G.P.x - destination.center, G.P.y - beam.row);
  // A pilot at the near edge can fly behind the card even in slow focus.
  e.duration = Math.max(e.duration, .72 + distance / 190);
}

function projectorThreat(G, e, x, y) {
  const beam = e.beam;
  const band = penumbra(beam, Math.max(beam.slideY + 4, y));
  const horizontal = Math.max(0, Math.abs(x - band.center) - band.half + 14);
  return (Math.max(0, beam.slideY + 12 - y) + horizontal) * 5;
}

function updateProjector(G, e) {
  if (e.phase !== "strike") return false;
  const { x, y } = G.P, beam = e.beam, band = penumbra(beam, y);
  return y < beam.slideY || Math.abs(x - band.center) > band.half;
}

function drawProjector(G, e, c, p) {
  const beam = e.beam, bottom = penumbra(beam, G.H), live = e.phase === "strike";
  const left = beam.slideX - beam.slideHalf, right = beam.slideX + beam.slideHalf;
  const bottomLeft = bottom.center - bottom.half, bottomRight = bottom.center + bottom.half;
  c.beginPath(); c.moveTo(left, beam.slideY); c.lineTo(right, beam.slideY);
  c.lineTo(bottomRight, G.H); c.lineTo(bottomLeft, G.H); c.closePath();
  c.save(); c.globalAlpha *= .24; c.fillStyle = p.deep; c.fill(); c.restore();
  c.strokeStyle = p.deep; c.lineWidth = live ? 3 : 2;
  for (const [edge, end] of [[left, bottomLeft], [right, bottomRight]]) {
    c.beginPath(); c.moveTo(edge, beam.slideY); c.lineTo(end, G.H); c.stroke();
    c.save(); c.setLineDash(live ? [] : [4, 5]); c.strokeStyle = p.red; c.lineWidth = live ? 2.5 : 1.5;
    c.beginPath(); c.moveTo(beam.lensX, beam.lensY); c.lineTo(edge, beam.slideY); c.stroke(); c.restore();
  }
  // Flat, stationary hatching makes the safe wedge legible in both skins.
  c.save(); c.globalAlpha *= .40; c.strokeStyle = p.deep; c.lineWidth = 1;
  for (let y = beam.slideY + 16; y < G.H; y += 18) {
    const band = penumbra(beam, y), leftX = Math.max(0, band.center - band.half + 6), rightX = Math.min(G.W, band.center + band.half - 6);
    if (rightX > leftX) { c.beginPath(); c.moveTo(leftX, y); c.lineTo(rightX, y); c.stroke(); }
  }
  c.restore();
  // Two quiet warning stripes on the lit side of each edge stay still when the
  // lamp fires. Their endpoints use the projected edge at both heights.
  c.save(); c.globalAlpha *= .69; c.strokeStyle = p.red; c.lineWidth = 1.7;
  c.beginPath();
  for (let y = beam.slideY + 13; y < G.H - 7; y += 34) {
    const top = penumbra(beam, y), bottom = penumbra(beam, y + 6);
    const leftEdge = Math.min(top.center - top.half, bottom.center - bottom.half);
    const rightEdge = Math.max(top.center + top.half, bottom.center + bottom.half);
    for (const dx of [6, 12]) {
      c.moveTo(leftEdge - dx, y); c.lineTo(leftEdge - dx - 4, y + 6);
      c.moveTo(rightEdge + dx + 4, y); c.lineTo(rightEdge + dx, y + 6);
    }
  }
  c.stroke(); c.restore();
  c.fillStyle = p.ink; c.fillRect(left, beam.slideY - 8, beam.slideHalf * 2, 8);
  c.fillStyle = p.paper;
  for (const x of [left + 4, left + 9, right - 12, right - 7]) c.fillRect(x, beam.slideY - 6, 3, 3);
  if (e.cover) {
    const { x, y, scale, angle } = e.cover;
    c.save(); c.translate(x, y); c.rotate(angle); c.scale(scale, scale);
    c.fillStyle = p.deep; c.fillRect(-25, -9, 50, 18);
    c.fillStyle = p.paper; c.font = "bold 12px " + G.MONO; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("COVER", 0, .5); c.restore();
  }
  // The small lens changes state. The page stays at a constant brightness.
  c.strokeStyle = live ? p.red : p.ink; c.lineWidth = 2; c.fillStyle = live ? p.amber : p.paper;
  c.beginPath(); c.arc(beam.lensX, beam.lensY, live ? 7 : 5, 0, Math.PI * 2); c.fill(); c.stroke();
}

export const studioBosses = {
  carbon: { prepare: prepareCarbon, update: updateCarbon, draw: drawCarbon, threat: carbonThreat, jointY: .025 },
  projector: { prepare: prepareProjector, update: updateProjector, draw: drawProjector, threat: projectorThreat, jointY: .08 },
};
