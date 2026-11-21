// Body, cutscene portrait and defeat frame all use the same four registered poses.
// Coordinates for the ink drawings are relative to a 100 × 100 actor box.
const TAU = Math.PI * 2;
const paper = { ink: "#242b23", card: "#fcf5df", soft: "#64725f", wash: "#dce8d4", deep: "#267246" };

function plate(c, points, fill) {
  c.beginPath();
  c.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) c.lineTo(...points[i]);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.stroke();
}

function disc(c, x, y, radius, fill) {
  c.beginPath();
  c.arc(x, y, radius, 0, TAU);
  c.fillStyle = fill;
  c.fill();
  c.stroke();
}

function compass(c, pose, p) {
  const foot = [34, 25, 43, 31][pose];
  // The adjuster spans the two legs; the dark graphite tip distinguishes the drawing arm.
  c.lineWidth = 2.6;
  plate(c, [[-17, 12], [19, 12], [19, 16], [-17, 16]], p.wash);
  for (const sign of [-1, 1]) {
    c.save();
    c.scale(sign, 1);
    plate(c, [[2, -16], [10, -14], [foot + 3, 30], [foot - 3, 33], [2, -2]], p.card);
    plate(c, [[foot - 3, 31], [foot + 3, 29], [foot + 4, 45]], sign > 0 ? p.ink : p.wash);
    c.restore();
  }
  plate(c, [[-5, -39], [5, -39], [5, -16], [-5, -16]], p.wash);
  disc(c, 0, -13, 13, p.card);
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-6, -16); c.lineTo(-2, -14);
  c.moveTo(7, -17); c.lineTo(2, -14);
  c.stroke();
  disc(c, -4, -10, 1.4, p.ink);
  disc(c, 4, -10, 1.4, p.ink);
}

function metronome(c, pose, p) {
  if (pose === 3) {
    // The spent spring leaves its two-loop winding key exposed on the right of the case.
    c.save();
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(20, 3); c.lineTo(27, 3);
    c.bezierCurveTo(23, -4, 28, -10, 34, -7);
    c.bezierCurveTo(40, -4, 38, 3, 31, 5.5);
    c.bezierCurveTo(39, 9, 39, 16, 33, 18);
    c.bezierCurveTo(27, 19, 24, 14, 27, 8);
    c.lineTo(20, 8); c.closePath();
    c.fillStyle = p.amber ?? "#d3a444"; c.fill(); c.stroke();
    c.lineWidth = 1.4;
    disc(c, 32, -2, 2.5, p.card);
    disc(c, 32, 12.5, 2.5, p.card);
    c.restore();
  }
  plate(c, [[-12, -42], [12, -42], [34, 31], [31, 41], [-31, 41], [-34, 31]], p.wash);
  plate(c, [[-8, -34], [8, -34], [23, 18], [-23, 18]], p.card);
  c.lineWidth = 1.4;
  c.beginPath();
  for (let y = -24; y < 16; y += 7) { c.moveTo(-6, y); c.lineTo(2, y); }
  c.stroke();
  // The bob leans before the sweep; its position remains visible with sound off.
  const arm = [8, 14, 28, 0][pose];
  c.beginPath(); c.moveTo(0, 27); c.lineTo(arm, -32); c.lineWidth = 3; c.stroke();
  const bob = arm * .76;
  plate(c, [[bob - 4, -22], [bob + 6, -20], [bob + 4, -9], [bob - 6, -11]], p.deep);
  disc(c, 0, 26, 5, p.card);
  c.lineWidth = 2;
  for (const x of [-14, 14]) disc(c, x, 26, 1.5, p.ink);
}

function cellHalf(c, pose, p, side) {
  c.save();
  // Both membranes have a flat inner edge so the seam visible between them is real.
  c.scale(side, 1);
  const bulge = pose === 1 ? 28 : 23;
  c.beginPath();
  c.moveTo(-23, -8);
  c.bezierCurveTo(-23, -31, 1, -39, 16, -24);
  c.bezierCurveTo(bulge + 5, -12, bulge + 1, 16, 10, 27);
  c.bezierCurveTo(-4, 37, -23, 27, -23, 10);
  c.closePath();
  c.fillStyle = p.wash; c.fill(); c.stroke();
  disc(c, 1, -3, 9, p.card);
  disc(c, 2, -2, 2.3, p.ink);
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(-12, 13); c.quadraticCurveTo(-9, 20, -2, 20);
  c.moveTo(12, -15); c.lineTo(16, -12); c.stroke();
  c.restore();
}

function carbon(c, pose, p) {
  const platenY = [-1, -9, 11, 3][pose];
  plate(c, [[-32, -34], [17, -34], [25, -27], [-23, -27], [-23, 24], [-32, 24]], p.deep);
  plate(c, [[-34, 21], [25, 21], [35, 30], [32, 36], [-36, 36], [-39, 29]], p.soft);
  plate(c, [[-26, 17], [20, 17], [30, 24], [-20, 24]], p.card);
  c.lineWidth = 4;
  c.beginPath(); c.moveTo(0, -27); c.lineTo(0, platenY); c.stroke();
  c.lineWidth = 2.5;
  plate(c, [[-18, platenY], [15, platenY], [20, platenY + 9], [-21, platenY + 9]], p.wash);
  disc(c, 0, pose === 3 ? 2.5 : 10, pose === 3 ? 6 : 4, p.amber ?? "#d3a444");
  disc(c, 26, -19, 10, p.card);
  const crank = [-4, -8, 6, 3][pose];
  c.beginPath(); c.moveTo(26, -19); c.lineTo(32, -19 + crank); c.stroke();
  disc(c, 32, -19 + crank, 2.6, p.deep);
  for (const x of [-15, -6]) disc(c, x, -30, 1.8, p.ink);
}

function projector(c, pose, p) {
  const top = [-28, -33, -28, -24][pose];
  for (const x of [-23, 18]) plate(c, [[x, 25], [x + 7, 25], [x + 5, 34], [x - 3, 34]], p.soft);
  plate(c, [[-19, -18], [-16, top], [4, top], [6, -18]], p.card);
  plate(c, [[-33, -15], [-21, -23], [27, -23], [34, -15], [32, 25], [-29, 25], [-35, 16]], p.wash);
  c.lineWidth = 2;
  for (const y of [-10, -4, 2]) {
    c.beginPath(); c.moveTo(18, y); c.lineTo(28, y); c.stroke();
  }
  disc(c, 0, 8, 16, p.soft);
  disc(c, 0, 8, pose === 3 ? 12 : 10, pose === 2 ? p.card : p.amber ?? "#d3a444");
  disc(c, -3, 5, 3, p.card);
  disc(c, -21, -5, 2, p.ink);
}

function marginClip(c, pose, p) {
  const jaw = [5, 12, 1, 9][pose];
  plate(c, [[-28, -2], [20, -2], [33, 21], [26, 27], [-32, 27], [-36, 21]], p.deep);
  plate(c, [[-31, 21 - jaw], [27, 21 - jaw], [32, 20], [-34, 20]], p.wash);
  for (const i of [-1, 1]) {
    c.save(); c.scale(i, 1);
    c.beginPath(); c.moveTo(7, -2);
    c.bezierCurveTo(8, -10, 14, -16, 14, -25);
    c.bezierCurveTo(14, -35, 27, -34, 25, -24);
    c.lineTo(19, -3); c.lineWidth = 5; c.stroke();
    c.strokeStyle = p.card; c.lineWidth = 2; c.stroke(); c.restore();
    disc(c, i * 12, 7, 2.4, p.card);
  }
}

function pinwheel(c, pose, p) {
  c.beginPath(); c.moveTo(0, -3); c.lineTo(4, 40); c.lineWidth = 4; c.stroke();
  c.save(); c.translate(0, -5); c.rotate([0, -.22, .49, .16][pose]); c.lineWidth = 2;
  for (const color of [p.deep, p.card, p.wash, p.amber ?? "#d3a444"]) {
    plate(c, [[0, 0], [-12, -25], [18, -33], [14, -12]], color);
    plate(c, [[0, 0], [18, -33], [14, -12]], p.soft);
    c.rotate(Math.PI / 2);
  }
  disc(c, 0, 0, 5, p.card);
  c.restore();
}

function magnet(c, pose, p) {
  const tip = [25, 19, 29, 23][pose];
  c.beginPath(); c.moveTo(-31, tip);
  c.lineTo(-31, -3); c.bezierCurveTo(-31, -43, 31, -43, 31, -3);
  c.lineTo(31, tip); c.lineTo(15, tip); c.lineTo(15, -3);
  c.bezierCurveTo(15, -23, -15, -23, -15, -3); c.lineTo(-15, tip); c.closePath();
  c.fillStyle = p.soft; c.fill(); c.stroke();
  for (const side of [-1, 1]) {
    c.save(); c.scale(side, 1);
    plate(c, [[15, 8], [31, 8], [31, tip], [15, tip]], p.wash);
    disc(c, 11, -24, 2.5, p.card);
    c.restore();
  }
}

const inkActors = { compass, metronome, carbon, projector, clip: marginClip, pinwheel, magnet };

export function drawRivalActor(c, actor, sheet, palette = paper) {
  const { bossId, x, y, w, h } = actor;
  const pose = actor.bossPose ?? 0;
  const width = (sheet?.naturalWidth || 0) / 2;
  const height = (sheet?.naturalHeight || 0) / 2;
  const sx = (pose % 2) * width, sy = Math.floor(pose / 2) * height;
  c.save();
  c.strokeStyle = palette.ink;
  c.lineCap = c.lineJoin = "round";
  if (bossId === "cell") {
    // A split actor still owns one atlas frame. Paint each half at its own world-space collision centre.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const half = actor.bossLobes?.[i];
      const cx = half?.x ?? x + side * w / 4, cy = half?.y ?? y;
      if (width && height) {
        c.drawImage(sheet, sx + i * width / 2, sy, width / 2, height, cx - w / 4, cy - h / 2, w / 2, h);
      } else {
        c.save(); c.translate(cx, cy); c.scale(w / 100, h / 100);
        c.lineWidth = 2.6;
        cellHalf(c, pose, palette, side);
        c.restore();
      }
    }
  } else {
    c.translate(x, y);
    if (bossId === "metronome" && actor.beatSide && (pose === 1 || pose === 2)) {
      // The painted bob winds up on the left and swings on the right. The ink bob is drawn pointing right.
      const facing = width && height && pose === 1 ? -1 : 1;
      if (actor.beatSide !== facing) c.scale(-1, 1);
    }
    if (width && height) c.drawImage(sheet, sx, sy, width, height, -w / 2, -h / 2, w, h);
    else {
      c.scale(w / 100, h / 100);
      c.lineWidth = 2.6;
      inkActors[bossId]?.(c, pose, palette);
    }
  }
  c.restore();
}
