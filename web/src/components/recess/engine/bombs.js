export const RECESS_BOMBS = {
  eureka: { name: "Eureka", effect: "Clear the page of bullets, collect the sparks, and hit every active enemy." },
  sweep: { name: "Redaction sweep", effect: "Send a line up the page. It erases shots and hits each enemy it crosses." },
  inkwell: { name: "Ink well", effect: "Leave a pool where you fire. It catches incoming shots for two and a half seconds." },
};

export function resolveBombKind(value) {
  return Object.hasOwn(RECESS_BOMBS, value) ? value : "eureka";
}

function strike(G, foe) {
  const kind = G.kinds[foe.k];
  if (kind?.bombed) kind.bombed(G, foe);
  else G.hurtFoe(foe, 26);
}

export function releaseBomb(G) {
  const { x, y } = G.P;
  const kind = resolveBombKind(G.bombKind);
  if (kind === "eureka") {
    G.P.inv = Math.max(G.P.inv, 1.4);
    G.cancelBullets(true);
    G.ring = { x, y, r: 0 };
    G.emit("bomb", { x, y, kind });
    for (const foe of G.foes.slice()) if (!foe.dead && !(foe.born > 0)) strike(G, foe);
    return;
  }
  G.P.inv = Math.max(G.P.inv, 0.28);
  if (kind === "sweep") {
    const floor = G.H + 12;
    G.bombFields.push({ kind, y: floor, previous: floor, age: 0, sparks: 48, hit: new Set() });
  } else {
    const radius = Math.max(44, Math.min(72, G.W * 0.15));
    G.bombFields.push({ kind, x, y, radius, age: 0, sparks: 30 });
  }
  G.emit("bomb", { x, y, kind });
}

export function advanceBombFields(G, dt) {
  if (!G.bombFields.length) return;
  for (const field of G.bombFields) {
    field.age += dt;
    if (field.kind !== "sweep") continue;
    field.previous = field.y;
    field.y -= (G.H + 24) * dt;
    for (const foe of G.foes.slice()) {
      if (foe.dead || foe.born > 0 || field.hit.has(foe)) continue;
      const radius = foe.h ? foe.h / 2 : foe.r;
      if (foe.y + radius < field.y - 6 || foe.y - radius > field.previous + 6) continue;
      field.hit.add(foe);
      strike(G, foe);
    }
  }
  G.bombFields = G.bombFields.filter(field => field.kind === "sweep" ? field.previous >= -12 : field.age < 2.5);
}

// Test the path travelled this tick. A fast shot can cross a pool between two frames.
export function interceptBombBullet(G, b, fromX, fromY) {
  if (!G.bombFields.length) return false;
  let x = b.x, y = b.y;
  if (b.k === 6 && b.len > 0) {
    fromX = b.x; fromY = b.y;
    x += Math.cos(b.ang) * b.len; y += Math.sin(b.ang) * b.len;
  }
  for (const field of G.bombFields) {
    let sparkX = b.x, sparkY = b.y;
    if (field.kind === "sweep") {
      if (Math.min(fromY, y) > field.previous + 6 || Math.max(fromY, y) < field.y - 6) continue;
      if (b.k === 6) {
        const fraction = Math.max(0, Math.min(1, (field.y - fromY) / (y - fromY || 1)));
        sparkX = fromX + fraction * (x - fromX); sparkY = fromY + fraction * (y - fromY);
      }
    } else if (b.k === 9 && Number.isFinite(b.gx)) {
      // The moving rule has a real gap. A pool wholly inside that gap touches no ink.
      const distanceX = Math.max(0, b.gw / 2 - Math.abs(field.x - b.gx));
      const distanceY = Math.max(0, Math.min(fromY, y) - field.y, field.y - Math.max(fromY, y));
      if (Math.hypot(distanceX, distanceY) > field.radius + b.r) continue;
      sparkX = field.x; sparkY = b.y;
    } else if (b.k === 10) {
      const distanceX = Math.max(0, Math.min(fromX, x) - 12 - field.x, field.x - Math.max(fromX, x) - 12);
      const distanceY = Math.max(0, G.floorY - 22 - field.y);
      if (Math.hypot(distanceX, distanceY) > field.radius) continue;
      sparkY = Math.max(G.floorY - 22, field.y);
    } else {
      const dx = x - fromX, dy = y - fromY;
      const along = Math.max(0, Math.min(1, ((field.x - fromX) * dx + (field.y - fromY) * dy) / (dx * dx + dy * dy || 1)));
      sparkX = fromX + along * dx; sparkY = fromY + along * dy;
      if (Math.hypot(sparkX - field.x, sparkY - field.y) > field.radius + b.r) continue;
    }
    if (field.sparks > 0) {
      field.sparks--;
      G.addPick("s", sparkX, sparkY, true);
    }
    return true;
  }
  return false;
}

export function drawBombFields(G) {
  const c = G.c, pal = G.pal;
  for (const field of G.bombFields) {
    c.save();
    if (field.kind === "sweep") {
      c.fillStyle = pal.deep; c.globalAlpha = 0.12;
      c.fillRect(0, field.y, G.W, 18); c.globalAlpha = 1;
      c.strokeStyle = pal.deep; c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, field.y); c.lineTo(G.W, field.y); c.stroke();
      c.lineWidth = 1; c.setLineDash([9, 5]);
      c.beginPath(); c.moveTo(0, field.y + 8); c.lineTo(G.W, field.y + 8); c.stroke();
    } else {
      const { x, y, radius, age } = field;
      const turn = G.calm ? 0 : age * 1.8;
      c.globalAlpha = Math.min(1, (2.5 - age) * 4) * 0.15;
      c.fillStyle = pal.deep;
      c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
      c.globalAlpha *= 5; c.strokeStyle = pal.deep; c.lineWidth = 2; c.stroke();
      c.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const a = turn + i * Math.PI * 2 / 3;
        c.beginPath(); c.arc(x, y, radius * 0.78, a, a + 1.15); c.stroke();
      }
      c.fillStyle = pal.deep;
      c.translate(x, y); c.rotate(Math.PI / 4); c.fillRect(-3, -3, 6, 6);
    }
    c.restore();
  }
}
