import type { CliRenderer, Renderable } from "@opentui/core";
import {
  Color,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Shape,
} from "three";

/**
 * Silhouette of the Keating brand mark: a squared stem with two wedge arms that
 * meet at a waist just right of the stem. Traced clockwise from the stem's
 * bottom-left so the extrusion caps stay consistently wound.
 */
const K_OUTLINE: readonly (readonly [number, number])[] = [
  [-0.62, -0.95],
  [-0.62, 0.95],
  [-0.26, 0.95],
  [-0.26, 0.16],
  [0.30, 0.95],
  [0.78, 0.95],
  [0.06, -0.02],
  [0.80, -0.95],
  [0.30, -0.95],
  [-0.26, -0.18],
  [-0.26, -0.95],
];

export function createKeatingMarkShape(): Shape {
  const shape = new Shape();
  const [start, ...rest] = K_OUTLINE;
  shape.moveTo(start![0], start![1]);
  for (const [x, y] of rest) shape.lineTo(x, y);
  shape.closePath();
  return shape;
}

/** Extruded brand mark: a dark solid so back edges occlude, plus bright edges. */
export function createKeatingMarkObject(edgeColor: string, fillColor: string): Group {
  const geometry = new ExtrudeGeometry(createKeatingMarkShape(), {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.045,
    bevelSegments: 2,
    curveSegments: 1,
  });
  geometry.center();
  const group = new Group();
  group.add(new Mesh(geometry, new MeshBasicMaterial({ color: new Color(fillColor) })));
  group.add(new LineSegments(
    new EdgesGeometry(geometry, 20),
    new LineBasicMaterial({ color: new Color(edgeColor) }),
  ));
  return group;
}

export interface ThreeLogoOptions {
  id?: string;
  width?: number | `${number}%`;
  height?: number;
  edgeColor?: string;
  fillColor?: string;
}

/**
 * Mount the Three.js brand mark. It needs a WebGPU device, which many terminals
 * and runtimes do not expose, so a null return is the normal path and callers
 * keep the flat ASCII wordmark from logo.ts.
 */
export async function tryCreateThreeLogo(
  renderer: CliRenderer,
  options: ThreeLogoOptions = {},
): Promise<Renderable | null> {
  if (process.env.KEATING_3D_LOGO === "0" || process.env.KEATING_3D_LOGO === "false") return null;
  if (typeof navigator === "undefined" || !(navigator as { gpu?: unknown }).gpu) return null;
  try {
    const { ThreeRenderable, SuperSampleType } = await import("@opentui/three");
    const scene = new Scene();
    scene.background = null;
    const mark = createKeatingMarkObject(options.edgeColor ?? "#e7a04f", options.fillColor ?? "#12160f");
    scene.add(mark);
    const camera = new PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.z = 4.2;
    let elapsed = 0;
    return new ThreeRenderable(renderer as never, {
      id: options.id ?? "keating-three-logo",
      width: options.width ?? "100%",
      height: options.height ?? 8,
      scene,
      camera,
      autoAspect: true,
      renderer: { alpha: true, superSample: SuperSampleType.NONE },
      renderBefore: (_buffer, deltaTime) => {
        elapsed += Math.min(deltaTime, 100);
        // A bounded sweep instead of a full spin: the K stays legible throughout.
        mark.rotation.y = Math.sin(elapsed / 1400) * 0.62;
        mark.rotation.x = Math.sin(elapsed / 2600) * 0.14;
      },
    });
  } catch {
    return null;
  }
}
