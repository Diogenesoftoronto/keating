/* The WebGL view. Loaded lazily by the component (dynamic import) after mount, so nothing here runs during
   SSR and the three.js chunk is only fetched when an Anatomy3D reply is on screen. */
import * as THREE from "three";
import { basisFor, ringPoints, samplePoints, smoothPath, type Model, type Structure, type Tone, type V3 } from "./engine";

export type ViewPoint = { x: number; y: number };
export interface AnatomyView {
  pick(clientX: number, clientY: number): string | null;
  hitsPlane(clientX: number, clientY: number): boolean;
  sheetPoint(clientX: number, clientY: number): V3 | null;
  project(p: V3): ViewPoint | null;          // model-local point → client coords
  screenPointFor(id: string): ViewPoint | null;
  setRotation(yaw: number, pitch: number): void;
  setHighlight(ids: string[]): void;
  setDim(ids: string[]): void;
  setOffset(id: string, off: V3 | null): void;
  worldDelta(dx: number, dy: number): V3;     // screen pixels → model-local displacement in the view plane
  setSection(y: number | null): void;
  setPath(points: V3[]): void;
  resize(): void;
  onFrame(cb: () => void): void;
  destroy(): void;
}

const TONES: Record<Tone, number> = {
  deoxy: 0x5f8fd8, oxy: 0xd2645f, valve: 0xf0c868, coronary: 0xee8a3c, airway: 0x8fd0c4, gut: 0xc99f7c, bone: 0xe8e2d2, lung: 0x9fb8cc,
};

/* webglAvailable() lives in engine.ts so the component can probe before importing this (three.js) chunk. */
export { webglAvailable } from "./engine";
/* Module-load flag: the no-WebGL test asserts this chunk is never evaluated. */
try { (globalThis as unknown as { __keatingView3dLoaded?: boolean }).__keatingView3dLoaded = true; } catch { /* ignore */ }

export function createView(host: HTMLElement, model: Model, opts: { section: boolean; reducedMotion: boolean }): AnatomyView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "an-gl";
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(-6, 10, 14); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(8, -4, -10); scene.add(rim);

  const pivot = new THREE.Group(); scene.add(pivot);            // rotates; centred on the model
  const root = new THREE.Group(); pivot.add(root);               // model-local frame
  root.position.set(-model.center[0], -model.center[1], -model.center[2]);
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);  // world-space, updated each frame
  const clipLocal = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  let sectionY: number | null = null;

  type Part = { s: Structure; group: THREE.Group; fronts: THREE.Mesh[]; backs: THREE.Mesh[]; mat: THREE.MeshStandardMaterial; back: THREE.MeshBasicMaterial; base: number };
  const parts = new Map<string, Part>();
  const translucent = (s: Structure) => !opts.section && (s.tone === "deoxy" || s.tone === "oxy") && /Atrium|Ventricle/.test(s.id);
  for (const s of model.structures) {
    const lung = s.tone === "lung", bone = s.id === "sternum";
    const opacity = lung ? 0.13 : bone ? 0.3 : translucent(s) ? 0.4 : 1;
    const mat = new THREE.MeshStandardMaterial({ color: TONES[s.tone], roughness: 0.55, metalness: 0.02, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 || lung ? opacity >= 1 : false, clippingPlanes: [clip] });
    if (lung) mat.depthWrite = false;
    const back = new THREE.MeshBasicMaterial({ color: new THREE.Color(TONES[s.tone]).multiplyScalar(0.62), side: THREE.BackSide, clippingPlanes: [clip], transparent: opacity < 1, opacity: Math.min(1, opacity + 0.2), depthWrite: opacity >= 1 });
    const group = new THREE.Group(); group.userData.id = s.id; root.add(group);
    const fronts: THREE.Mesh[] = [], backs: THREE.Mesh[] = [];
    for (const p of s.prims) {
      let geo: THREE.BufferGeometry; const xf = new THREE.Matrix4();
      if (p.k === "ell") {
        geo = new THREE.SphereGeometry(1, 40, 28);
        const R = basisFor(p.axis);
        xf.makeBasis(new THREE.Vector3(R[0][0], R[1][0], R[2][0]), new THREE.Vector3(R[0][1], R[1][1], R[2][1]), new THREE.Vector3(R[0][2], R[1][2], R[2][2]));
        xf.multiply(new THREE.Matrix4().makeScale(p.r[0], p.r[1], p.r[2])); xf.setPosition(p.c[0], p.c[1], p.c[2]);
      } else if (p.k === "cyl") {
        geo = new THREE.CylinderGeometry(1, 1, 2, 28); xf.makeScale(p.rx, p.h, p.rz); xf.setPosition(p.c[0], p.c[1], p.c[2]);
      } else if (p.k === "tube") {
        const pts = smoothPath(p.path).map(q => new THREE.Vector3(...q));
        geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5), Math.max(12, pts.length * 2), p.r, 16, false);
        // close the ends so a cut tube shows a filled cap
        const caps = [pts[0], pts[pts.length - 1]].map((c, i) => { const g = new THREE.CircleGeometry(p.r, 16); const d = (i ? pts[pts.length - 1].clone().sub(pts[pts.length - 2]) : pts[0].clone().sub(pts[1])).normalize(); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d)); g.translate(c.x, c.y, c.z); return g; });
        for (const g of caps) { const m1 = new THREE.Mesh(g, mat); m1.userData.id = s.id; group.add(m1); fronts.push(m1); }
      } else {
        const pts = ringPoints(p, 48).map(q => new THREE.Vector3(...q));
        geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.slice(0, -1), true), 64, p.r, 10, true);
      }
      geo.applyMatrix4(xf);
      const front = new THREE.Mesh(geo, mat); front.userData.id = s.id; front.renderOrder = lung ? 3 : mat.transparent ? 2 : 0;
      const backMesh = new THREE.Mesh(geo, back); backMesh.userData.id = s.id; backMesh.renderOrder = front.renderOrder;
      group.add(backMesh, front); fronts.push(front); backs.push(backMesh);
    }
    parts.set(s.id, { s, group, fronts, backs, mat, back, base: TONES[s.tone] });
  }

  /* Section plane: a translucent sheet with an outline, in model-local coordinates */
  const span = model.vertebrae ? 13 : model.radius * 0.85;
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, span * (model.vertebrae ? 1.45 : 1.5)), new THREE.MeshBasicMaterial({ color: 0x9fd8bb, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  sheet.rotation.x = -Math.PI / 2; sheet.renderOrder = 4;
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(sheet.geometry), new THREE.LineBasicMaterial({ color: 0x8dd8ae, transparent: true, opacity: 0.9 }));
  sheet.add(edge); sheet.visible = false; root.add(sheet);
  sheet.position.set(model.center[0], 0, model.center[2]);

  const pathMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false });
  let pathLine: THREE.Line | null = null;

  let yaw = 0, pitch = 0, dirty = true, frameCb: (() => void) | null = null, raf = 0;
  const offsets = new Map<string, { cur: THREE.Vector3; target: THREE.Vector3 }>();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function fit() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const r = model.radius, fov = camera.fov * Math.PI / 180;
    const dist = Math.max(r / Math.sin(fov / 2), r / Math.sin(Math.atan(Math.tan(fov / 2) * camera.aspect))) * 0.92;
    camera.position.set(0, 0, dist); camera.near = dist - r * 2; camera.far = dist + r * 2; camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix(); dirty = true;
  }
  function tick() {
    raf = requestAnimationFrame(tick);
    let moving = false;
    for (const [id, o] of offsets) {
      if (opts.reducedMotion) o.cur.copy(o.target); else o.cur.lerp(o.target, 0.25);
      if (o.cur.distanceTo(o.target) < 0.01) o.cur.copy(o.target); else moving = true;
      parts.get(id)!.group.position.copy(o.cur);
      if (o.target.lengthSq() === 0 && o.cur.lengthSq() === 0) offsets.delete(id);
      dirty = true;
    }
    if (!dirty && !moving) return;
    dirty = false;
    pivot.rotation.set(pitch, yaw, 0, "YXZ");
    scene.updateMatrixWorld();
    if (sectionY === null) clip.set(new THREE.Vector3(0, -1, 0), 1e6);
    else { clipLocal.set(new THREE.Vector3(0, -1, 0), sectionY); clip.copy(clipLocal).applyMatrix4(root.matrixWorld); }
    renderer.render(scene, camera);
    frameCb?.();
  }
  const ro = new ResizeObserver(() => fit()); ro.observe(host);
  fit(); tick();

  function setNdc(cx: number, cy: number) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  const local = new THREE.Vector3();
  function pick(cx: number, cy: number): string | null {
    scene.updateMatrixWorld(); setNdc(cx, cy);
    const meshes: THREE.Object3D[] = [];
    for (const p of parts.values()) meshes.push(...p.fronts, ...(sectionY !== null ? p.backs : []));
    const hits = ray.intersectObjects(meshes, false).filter(h => {
      if (sectionY === null) return true;
      local.copy(h.point); root.worldToLocal(local);
      return local.y <= sectionY + 1e-3;
    });
    if (!hits.length) return null;
    let best = hits[0], bp = parts.get(best.object.userData.id)!.s.priority ?? 0;
    for (const h of hits) { const pr = parts.get(h.object.userData.id)!.s.priority ?? 0; if (pr > bp) { best = h; bp = pr; } }
    return best.object.userData.id;
  }
  function project(p: V3): ViewPoint | null {
    const v = new THREE.Vector3(...p);
    const id = [...parts.values()].find(q => q.s.anchor === p)?.s.id; // offsets follow pulled structures
    if (id && offsets.has(id)) v.add(offsets.get(id)!.cur);
    root.localToWorld(v); v.project(camera);
    if (v.z > 1) return null;
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }
  return {
    pick,
    hitsPlane(cx, cy) {
      if (sectionY === null) return false;
      scene.updateMatrixWorld(); setNdc(cx, cy);
      const h = ray.intersectObject(sheet, false)[0];
      return !!h;
    },
    sheetPoint(cx, cy) {
      if (sectionY === null) return null;
      scene.updateMatrixWorld(); setNdc(cx, cy);
      const h = ray.intersectObject(sheet, false)[0]; if (!h) return null;
      const q = root.worldToLocal(h.point.clone());
      return [q.x, q.y, q.z];
    },
    project,
    screenPointFor(id) {
      const p = parts.get(id); if (!p) return null;
      const r = renderer.domElement.getBoundingClientRect();
      for (const q of samplePoints(p.s)) {
        if (sectionY !== null && q[1] > sectionY) continue;
        const s = project(q); if (!s) continue;
        if (s.x < r.left + 4 || s.x > r.right - 4 || s.y < r.top + 4 || s.y > r.bottom - 4) continue;
        if (pick(s.x, s.y) === id) return s;
      }
      return null;
    },
    setRotation(y, x) { yaw = y; pitch = x; dirty = true; },
    setHighlight(ids) {
      for (const p of parts.values()) { const on = ids.includes(p.s.id); p.mat.emissive.setHex(on ? 0xffffff : 0x000000); p.mat.emissiveIntensity = on ? 0.28 : 0; }
      dirty = true;
    },
    setDim(ids) {
      for (const p of parts.values()) p.group.visible = !ids.includes(p.s.id);
      dirty = true;
    },
    setOffset(id, off) {
      const p = parts.get(id); if (!p) return;
      const o = offsets.get(id) ?? { cur: p.group.position.clone(), target: new THREE.Vector3() };
      o.target.set(...(off ?? [0, 0, 0]));
      if (off) o.cur.copy(o.target); // follows the hand exactly; only the snap back animates
      offsets.set(id, o); dirty = true;
    },
    worldDelta(dx, dy) {
      const r = renderer.domElement.getBoundingClientRect();
      const dist = camera.position.length();
      const perPx = 2 * dist * Math.tan(camera.fov * Math.PI / 360) / r.height;
      const v = new THREE.Vector3(dx * perPx, -dy * perPx, 0);
      v.applyQuaternion(pivot.quaternion.clone().invert());
      return [v.x, v.y, v.z];
    },
    setSection(y) {
      sectionY = y; sheet.visible = y !== null; if (y !== null) sheet.position.y = y;
      for (const p of parts.values()) for (const b of p.backs) b.visible = y !== null || p.mat.transparent;
      dirty = true;
    },
    setPath(points) {
      if (pathLine) { root.remove(pathLine); pathLine.geometry.dispose(); pathLine = null; }
      if (points.length > 1) {
        const curve = new THREE.CatmullRomCurve3(points.map(q => new THREE.Vector3(...q)), false, "centripetal");
        pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(points.length * 12)), pathMat);
        pathLine.renderOrder = 10; root.add(pathLine);
      }
      dirty = true;
    },
    resize: fit,
    onFrame(cb) { frameCb = cb; dirty = true; },
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect();
      scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mt = m.material as THREE.Material | undefined; mt?.dispose?.(); });
      renderer.dispose(); renderer.forceContextLoss?.(); renderer.domElement.remove();
    },
  };
}
