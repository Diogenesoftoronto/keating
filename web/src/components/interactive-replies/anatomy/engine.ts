/* Anatomy3D engine: the vetted procedural anatomy library, geometry maths (slicing and projection),
   the blood-flow graph, config validation and the scripted feedback/share text.
   Pure TypeScript: no DOM, no three.js, safe to import on the server and in the validator sweep.

   Frame (patient coordinates, schematic, 1 unit ≈ 1 cm):
     +x = patient's LEFT, +y = SUPERIOR, +z = ANTERIOR.
   So the default camera on +z looks at the anterior surface, with the patient's right on the viewer's left,
   exactly as an atlas plate or a CT slice puts it.
   Vertical frame: the T4/T5 disc (sternal angle plane) is y = 0; each thoracic level is 2.4 units,
   so the body of Tn is centred on y = (4.5 − n) × 2.4. Sources for every relation are in NOTES.md. */

export type V3 = [number, number, number];
export type Prim =
  | { k: "ell"; c: V3; r: V3; axis?: V3 }                 // ellipsoid; r[0] lies along `axis` (default +x)
  | { k: "tube"; path: V3[]; r: number }                  // smooth tube through the points
  | { k: "ring"; c: V3; n: V3; R: number; r: number }     // valve annulus: torus, normal n
  | { k: "cyl"; c: V3; rx: number; rz: number; h: number }; // vertical elliptic cylinder, half-height h

export type Tone = "deoxy" | "oxy" | "valve" | "coronary" | "airway" | "gut" | "bone" | "lung";
export type Structure = {
  id: string; name: string; short: string; tone: Tone; prims: Prim[]; anchor: V3;
  info: string;       // what it is and its key relations (shown on tap / after a correct label)
  hint: string;       // how to recognise it on the model (used when a label lands on the wrong structure)
  sliceHint?: string; // how to recognise it on an axial slice
  priority?: number;  // picking: valves 2 (small, inside translucent chambers), lungs −1
};
export type ModelId = "heart" | "thoracicCrossSection";
export type Model = {
  id: ModelId; title: string; structures: Structure[]; flow: [string, string][];
  vertebrae: boolean; center: V3; radius: number;
};

/* ---------------- The heart (shared by both models) ---------------- */
const SVC_PATH: V3[] = [[-3.0, 5.5, 1.0], [-3.1, 0, 0.8], [-3.2, -4.6, 0.5]];
const AORTA_HEART: V3[] = [[0.3, -6.0, 0.8], [-0.5, -3.5, 1.6], [-1.2, 0, 1.8], [-0.8, 1.6, 1.0], [0.4, 2.2, -1.6], [1.8, 1.6, -4.4], [2.4, 0, -6.2], [2.4, -6, -6.4]];
const AORTA_THORAX: V3[] = [...AORTA_HEART.slice(0, -1), [2.3, -6, -6.35], [2.2, -9, -6.2], [1.2, -14, -5.6], [0.4, -18, -5.2]];
const LV_BASE: V3 = [1.2, -7.4, -1.2], LV_APEX: V3 = [5.6, -12.2, 2.6];
const LV_AXIS = sub(LV_APEX, LV_BASE);
const LV_CENTER = lerp3(LV_BASE, LV_APEX, 0.5);
const RA_C: V3 = [-3.2, -6.6, 0.4], RV_C: V3 = [0.9, -8.4, 3.0], LA_C: V3 = [1.0, -5.4, -2.6];

function heartStructures(thorax: boolean): Structure[] {
  return [
    { id: "superiorVenaCava", name: "Superior vena cava", short: "SVC", tone: "deoxy", prims: [{ k: "tube", path: SVC_PATH, r: 1.0 }], anchor: [-3.1, 1.5, 0.8],
      info: "Returns blood from the head, neck and upper limbs to the right atrium. It lies to the right of the ascending aorta.",
      hint: "the vertical vein entering the right atrium from above, to the right of the ascending aorta",
      sliceHint: "the vein on the patient's right of the ascending aorta; follow it down towards the right atrium" },
    { id: "inferiorVenaCava", name: "Inferior vena cava", short: "IVC", tone: "deoxy", prims: [{ k: "tube", path: thorax ? [[-2.4, -13, -1.6], [-2.8, -10, -0.6], [-3.1, -7.8, 0]] : [[-2.6, -11.6, -1.2], [-2.8, -10, -0.6], [-3.1, -7.8, 0]], r: 1.1 }], anchor: [-2.8, -10.4, -0.6],
      info: "Returns blood from below the diaphragm. It passes through the caval opening of the diaphragm (traditionally taught at T8; the level varies on CT) and enters the right atrium almost at once.",
      hint: "the short wide vein entering the right atrium from below",
      sliceHint: "the round vessel joining the back of the right atrium at the level of the diaphragm" },
    { id: "rightAtrium", name: "Right atrium", short: "RA", tone: "deoxy", prims: [{ k: "ell", c: RA_C, r: [2.0, 2.6, 2.2] }], anchor: [-4.4, -6.4, 1.2],
      info: "Receives both venae cavae and the coronary sinus. It forms the right border of the heart and empties through the tricuspid valve.",
      hint: "the chamber on the right border of the heart, where both venae cavae enter",
      sliceHint: "the chamber on the patient's right, forming the right heart border" },
    { id: "tricuspidValve", name: "Tricuspid valve", short: "Tricuspid", tone: "valve", priority: 2, prims: [{ k: "ring", c: [-1.4, -7.4, 1.6], n: norm([2.3, -1.0, 1.4]), R: 1.3, r: 0.2 }], anchor: [-1.4, -7.4, 1.6],
      info: "The right atrioventricular valve: three cusps between the right atrium and right ventricle. Chordae tendineae and papillary muscles stop the cusps everting when the ventricle contracts.",
      hint: "on the right side, between the right atrium and right ventricle (three cusps; ‘tri’ on the right)" },
    { id: "rightVentricle", name: "Right ventricle", short: "RV", tone: "deoxy", prims: [{ k: "ell", c: RV_C, r: [3.0, 2.1, 1.6], axis: [1, -0.35, 0] }, { k: "tube", path: [[0.9, -7.4, 3.2], [1.6, -5.6, 3.2], [1.9, -4.6, 3.0]], r: 1.0 }], anchor: [0.4, -8.6, 4.3],
      info: "Forms most of the anterior (sternocostal) surface of the heart. It pumps through its outflow tract (the conus arteriosus, or infundibulum) and the pulmonary valve.",
      hint: "the chamber forming most of the front of the heart, leading up to the pulmonary trunk",
      sliceHint: "the most anterior chamber, directly behind the sternum" },
    { id: "pulmonaryValve", name: "Pulmonary valve", short: "Pulmonary", tone: "valve", priority: 2, prims: [{ k: "ring", c: [1.9, -4.4, 2.9], n: norm([0.1, 0.9, -0.35]), R: 0.95, r: 0.18 }], anchor: [1.9, -4.4, 2.9],
      info: "The semilunar valve at the top of the right ventricle's outflow tract, opening into the pulmonary trunk. It is the most anterior and superior of the four valves.",
      hint: "the highest and most anterior valve, at the top of the right ventricle where the pulmonary trunk begins" },
    { id: "pulmonaryTrunk", name: "Pulmonary trunk", short: "Pulm. trunk", tone: "deoxy", prims: [{ k: "tube", path: [[1.9, -4.2, 2.8], [2.2, -2.6, 2.0], [1.6, -1.2, 0.0]], r: 1.1 }], anchor: [2.2, -2.6, 2.0],
      info: "Leaves the right ventricle in front of and to the left of the ascending aorta, spirals backwards around it, and divides into the right and left pulmonary arteries in the concavity of the aortic arch.",
      hint: "the vessel leaving the right ventricle, in front of and to the left of the ascending aorta",
      sliceHint: "the vessel to the left of and in front of the ascending aorta" },
    { id: "pulmonaryArteries", name: "Pulmonary arteries", short: "Pulm. arteries", tone: "deoxy", prims: [{ k: "tube", path: [[1.2, -1.3, -0.4], [-1.0, -1.6, -1.6], [-3.6, -1.9, -2.2], [-5.6, -2.4, -2.6]], r: 0.8 }, { k: "tube", path: [[1.8, -1.2, -0.4], [3.6, -0.9, -2.0], [5.4, -1.4, -3.2]], r: 0.8 }], anchor: [-3.6, -1.9, -2.2],
      info: "The right and left pulmonary arteries carry deoxygenated blood to the lungs. The right passes behind the ascending aorta and superior vena cava; the left passes over the left main bronchus.",
      hint: "the two branches of the pulmonary trunk running sideways to the lungs, under the aortic arch" },
    { id: "pulmonaryVeins", name: "Pulmonary veins", short: "Pulm. veins", tone: "oxy", prims: [
        { k: "tube", path: [[-4.6, -3.6, -2.6], [-1.3, -4.6, -2.8]], r: 0.55 }, { k: "tube", path: [[-4.4, -6.0, -3.4], [-1.3, -5.9, -3.0]], r: 0.55 },
        { k: "tube", path: [[5.0, -3.4, -2.8], [3.3, -4.7, -2.7]], r: 0.55 }, { k: "tube", path: [[4.8, -5.8, -3.4], [3.3, -6.0, -2.9]], r: 0.55 }], anchor: [4.6, -3.6, -2.8],
      info: "Four veins, two from each lung, carrying oxygenated blood into the left atrium.",
      hint: "the four short veins entering the back of the heart from both sides" },
    { id: "leftAtrium", name: "Left atrium", short: "LA", tone: "oxy", prims: [{ k: "ell", c: LA_C, r: [2.6, 1.7, 1.8] }], anchor: [2.9, -4.6, -3.4],
      info: "Forms most of the base (posterior surface) of the heart. It is the most posterior chamber and receives the four pulmonary veins. The esophagus runs close behind it, across the pericardium and a variable layer of fibrofatty tissue.",
      hint: "the most posterior chamber, where the four pulmonary veins enter",
      sliceHint: "the most posterior chamber, just in front of the esophagus" },
    { id: "mitralValve", name: "Mitral valve", short: "Mitral", tone: "valve", priority: 2, prims: [{ k: "ring", c: [1.9, -7.0, -1.2], n: norm(sub(LV_CENTER, [1.9, -7.0, -1.2])), R: 1.25, r: 0.2 }], anchor: [1.9, -7.0, -1.2],
      info: "The left atrioventricular (bicuspid) valve: two cusps between the left atrium and left ventricle. It is the most posterior valve.",
      hint: "on the left side, between the left atrium and left ventricle: the most posterior valve (two cusps)" },
    { id: "leftVentricle", name: "Left ventricle", short: "LV", tone: "oxy", prims: [{ k: "ell", c: LV_CENTER, r: [len(LV_AXIS) / 2, 2.5, 2.5], axis: LV_AXIS }, { k: "tube", path: [[2.0, -8.2, 0.6], [0.9, -6.8, 0.8], [0.3, -6.1, 0.8]], r: 1.0 }], anchor: [5.0, -11.0, 2.4],
      info: "Forms the apex, most of the left border and the diaphragmatic surface. Its wall is two to three times thicker than the right ventricle's, because it pumps against systemic pressure.",
      hint: "the chamber forming the apex and the left border of the heart",
      sliceHint: "the chamber on the patient's left, behind and to the left of the right ventricle. Wall thickness is not drawn in this schematic" },
    { id: "aorticValve", name: "Aortic valve", short: "Aortic", tone: "valve", priority: 2, prims: [{ k: "ring", c: [0.3, -6.0, 0.8], n: norm([-0.25, 0.95, 0.2]), R: 1.0, r: 0.18 }], anchor: [0.3, -6.0, 0.8],
      info: "The semilunar valve between the left ventricle and the ascending aorta. It lies behind and to the right of the pulmonary valve, wedged between the mitral and tricuspid valves. The coronary arteries arise from the aortic sinuses just above its cusps.",
      hint: "the central valve at the root of the aorta, behind and to the right of the pulmonary valve" },
    { id: "aorta", name: "Aorta", short: "Aorta", tone: "oxy", prims: [{ k: "tube", path: thorax ? AORTA_THORAX : AORTA_HEART, r: 1.3 }], anchor: [0.4, 2.2, -1.6],
      info: "The ascending aorta rises from the aortic valve. The arch begins and ends at the level of the sternal angle (traditionally T4/T5; on CT the arch is often lower), passing backwards and to the left over the root of the left lung. The descending aorta runs down to the left of the vertebral bodies and leaves the thorax through the aortic hiatus at T12.",
      hint: "the great artery rising from the centre of the heart and arching backwards and to the left",
      sliceHint: "at T4 the arch is one long curved shape from front-right to back-left; lower down the descending aorta is the round vessel to the left of the vertebral body" },
    { id: "rightCoronaryArtery", name: "Right coronary artery", short: "RCA", tone: "coronary", prims: [{ k: "tube", path: [[-0.4, -5.6, 1.6], [-1.4, -6.4, 2.8], [-2.6, -7.8, 2.6], [-3.2, -9.6, 1.4], [-2.6, -10.4, -0.6], [-1.0, -10.6, -1.8]], r: 0.3 }], anchor: [-2.6, -7.8, 2.6],
      info: "Arises from the right aortic sinus and runs in the right coronary (atrioventricular) groove. It supplies the right atrium and most of the right ventricle. It often supplies the SA node and usually the AV node (63% and 90% in one dissection series of 150 hearts, Pejković 2008). In right dominance, the commonest pattern, it gives the posterior interventricular artery.",
      hint: "the artery running in the groove between the right atrium and right ventricle" },
    { id: "leftCoronaryArtery", name: "Left coronary artery", short: "LCA", tone: "coronary", prims: [{ k: "tube", path: [[1.0, -5.6, 0.4], [1.9, -5.5, 1.0]], r: 0.34 }], anchor: [1.5, -5.55, 0.7],
      info: "The left main stem arises from the left aortic sinus, passes between the left auricle and the pulmonary trunk, and divides into the anterior interventricular (LAD) and circumflex branches.",
      hint: "the short main stem from the aortic root that divides into two branches" },
    { id: "leftAnteriorDescending", name: "Anterior interventricular artery (LAD)", short: "LAD", tone: "coronary", prims: [{ k: "tube", path: [[1.9, -5.5, 1.0], [2.6, -6.6, 3.4], [3.6, -9.0, 4.0], [5.4, -12.0, 2.9]], r: 0.28 }], anchor: [3.6, -9.0, 4.0],
      info: "Runs in the anterior interventricular groove to the apex. It supplies the anterior walls of both ventricles and the anterior two thirds of the interventricular septum.",
      hint: "the artery running down the front of the heart, in the groove between the two ventricles, to the apex" },
    { id: "circumflexArtery", name: "Circumflex artery", short: "Circumflex", tone: "coronary", prims: [{ k: "tube", path: [[1.9, -5.5, 1.0], [3.6, -6.4, -0.2], [4.8, -7.8, -1.6], [4.0, -9.2, -3.0]], r: 0.28 }], anchor: [4.8, -7.8, -1.6],
      info: "Follows the left coronary (atrioventricular) groove around the left border to the back of the heart. It supplies the left atrium, the lateral wall of the left ventricle and a variable posterior territory that depends on coronary dominance.",
      hint: "the artery curving round the left border of the heart in the groove between the left atrium and left ventricle" },
  ];
}

const Y = (n: number) => (4.5 - n) * 2.4;
function thoraxExtras(): Structure[] {
  return [
    { id: "trachea", name: "Trachea and main bronchi", short: "Trachea", tone: "airway", prims: [
        { k: "tube", path: [[-0.1, 9, -3.2], [-0.1, 4, -3.4], [-0.1, 0.2, -3.6]], r: 0.95 },
        // right main bronchus: short, ending at the early right upper lobe takeoff (prims[1])
        { k: "tube", path: [[-0.3, 0, -3.6], [-0.9, -0.65, -3.72], [-1.5, -1.3, -3.85]], r: 0.7 },
        // left main bronchus: about three times longer (prims[2])
        { k: "tube", path: [[0.3, 0, -3.6], [2.6, -1.4, -3.8], [4.6, -2.6, -4.0]], r: 0.58 },
        // beyond the right main bronchus: bronchus intermedius (prims[3]) and right upper lobe bronchus (prims[4])
        { k: "tube", path: [[-1.5, -1.3, -3.85], [-2.5, -2.8, -4.05], [-3.6, -3.9, -4.2]], r: 0.55 },
        { k: "tube", path: [[-1.5, -1.3, -3.85], [-2.3, -1.25, -3.95], [-3.1, -1.1, -4.05]], r: 0.4 }], anchor: [-0.1, 5, -3.4],
      info: "The trachea bifurcates at the carina, traditionally taught at the level of the sternal angle (T4/T5); on CT it is often a level lower. The right main bronchus is wider, shorter and more vertical than the left, so inhaled objects lodge more often on the right. It soon gives off the right upper lobe bronchus and continues as the bronchus intermedius.",
      hint: "the airway in the midline, behind the great vessels and in front of the esophagus",
      sliceHint: "the air-filled ring in the midline, in front of the esophagus" },
    { id: "esophagus", name: "Esophagus", short: "Esophagus", tone: "gut", prims: [{ k: "tube", path: [[-0.1, 9, -5.0], [0.1, 1.2, -5.3], [0.4, -5.4, -5.4], [1.0, -9.0, -4.9], [2.0, -12.6, -3.8], [2.6, -14.5, -3.2]], r: 0.8 }], anchor: [0.4, -8, -5.2],
      info: "Lies behind the trachea, then close behind the left atrium (across the pericardium and a variable layer of tissue), and passes through the diaphragm at the esophageal hiatus, to the left of the midline. The hiatus is traditionally taught at T10; on CT its level varies.",
      hint: "the muscular tube in front of the vertebral column, behind the trachea and then the left atrium",
      sliceHint: "the small soft-tissue tube just in front of the vertebral body: behind the trachea at T4, in front of and to the right of the descending aorta lower down" },
    { id: "azygosVein", name: "Azygos vein", short: "Azygos", tone: "deoxy", prims: [{ k: "tube", path: [[-1.2, -17, -6.3], [-1.2, -8, -6.3], [-1.0, -1, -6.4], [-1.8, 0.5, -5.3], [-2.8, 0.8, -2.4], [-3.0, 0.4, 0.6]], r: 0.5 }], anchor: [-1.2, -8, -6.3],
      info: "Ascends on the right front of the thoracic vertebral bodies and arches forwards over the root of the right lung, at about T4, to join the superior vena cava.",
      hint: "the thin vein running up the right front of the vertebral column and arching forwards into the SVC",
      sliceHint: "the small vessel on the right front of the vertebral body, to the right of the aorta" },
    { id: "vertebrae", name: "Thoracic vertebrae", short: "Vertebra", tone: "bone", prims: Array.from({ length: 12 }, (_, i): Prim => ({ k: "cyl", c: [0, Y(i + 1), -8], rx: 1.8, rz: 1.6, h: 0.95 })), anchor: [0, -4.8, -9.6],
      info: "The vertebral bodies T1–T12. Their levels are the reference used to name an axial slice.",
      hint: "the column of bones at the back", sliceHint: "the bright bone at the back of the slice" },
    { id: "sternum", name: "Sternum", short: "Sternum", tone: "bone", prims: [{ k: "ell", c: [0, 2.4, 8.4], r: [2.4, 2.4, 0.6] }, { k: "ell", c: [0, -5.4, 8.4], r: [1.6, 5.4, 0.6] }], anchor: [0, -2, 8.9],
      info: "The manubrium and the body of the sternum meet at the sternal angle, opposite the T4/T5 disc: the landmark for the second costal cartilage and the start and end of the aortic arch.",
      hint: "the flat bone at the front of the chest", sliceHint: "the bone at the front of the slice" },
    { id: "rightLung", name: "Right lung", short: "R lung", tone: "lung", priority: -1, prims: [{ k: "ell", c: [-6.6, -3, -2], r: [4.4, 11.4, 6.6] }], anchor: [-8.6, -6, 0],
      info: "Three lobes (upper, middle, lower), separated by the oblique and horizontal fissures.",
      hint: "the lung on the patient's right", sliceHint: "the dark (air-filled) field on the patient's right, which is your left" },
    { id: "leftLung", name: "Left lung", short: "L lung", tone: "lung", priority: -1, prims: [{ k: "ell", c: [6.8, -3.6, -2], r: [4.2, 10.8, 6.6] }], anchor: [8.8, -6, 0],
      info: "Two lobes (upper and lower) separated by the oblique fissure, with a cardiac notch where the heart reaches the chest wall.",
      hint: "the lung on the patient's left", sliceHint: "the dark (air-filled) field on the patient's left, which is your right" },
  ];
}

/* Blood flow, directed. Venae cavae → RA → tricuspid → RV → pulmonary valve → trunk → arteries → (lungs) → veins →
   LA → mitral → LV → aortic valve → aorta → coronary arteries. */
const HEART_FLOW: [string, string][] = [
  ["superiorVenaCava", "rightAtrium"], ["inferiorVenaCava", "rightAtrium"], ["rightAtrium", "tricuspidValve"], ["tricuspidValve", "rightVentricle"],
  ["rightVentricle", "pulmonaryValve"], ["pulmonaryValve", "pulmonaryTrunk"], ["pulmonaryTrunk", "pulmonaryArteries"], ["pulmonaryArteries", "pulmonaryVeins"],
  ["pulmonaryVeins", "leftAtrium"], ["leftAtrium", "mitralValve"], ["mitralValve", "leftVentricle"], ["leftVentricle", "aorticValve"], ["aorticValve", "aorta"],
  ["aorta", "rightCoronaryArtery"], ["aorta", "leftCoronaryArtery"], ["leftCoronaryArtery", "leftAnteriorDescending"], ["leftCoronaryArtery", "circumflexArtery"],
];

const cache: Partial<Record<ModelId, Model>> = {};
export const MODEL_IDS: ModelId[] = ["heart", "thoracicCrossSection"];
export function getModel(id: ModelId): Model {
  if (cache[id]) return cache[id]!;
  const m: Model = id === "heart"
    ? { id, title: "The heart", structures: heartStructures(false), flow: HEART_FLOW, vertebrae: false, center: [0.6, -4.6, 0], radius: 10.5 }
    : { id, title: "The thorax", structures: [...thoraxExtras().slice(0, 5), ...heartStructures(true), ...thoraxExtras().slice(5)], flow: [...HEART_FLOW, ["azygosVein", "superiorVenaCava"]], vertebrae: true, center: [0, -4.5, -1], radius: 14.5 };
  cache[id] = m;
  return m;
}
export const structureOf = (m: Model, id: string) => m.structures.find(s => s.id === id);
export const nameOf = (m: Model, id: string) => structureOf(m, id)?.name ?? id;
const lower = (s: string) => s.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
export const theName = (m: Model, id: string) => "the " + lower(nameOf(m, id));

/* ---------------- Vector maths ---------------- */
export function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function len(a: V3) { return Math.hypot(a[0], a[1], a[2]); }
export function norm(a: V3): V3 { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
export function lerp3(a: V3, b: V3, t: number): V3 { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
type M3 = [V3, V3, V3]; // rows

/* Shortest-arc rotation taking +x to `axis` (Rodrigues). three.js Quaternion.setFromUnitVectors gives the same rotation. */
export function basisFor(axis?: V3): M3 {
  if (!axis) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const a = norm(axis), c = a[0];
  const v: V3 = [0, -a[2], a[1]]; // x̂ × a
  const s2 = v[1] * v[1] + v[2] * v[2];
  if (s2 < 1e-12) return c > 0 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[-1, 0, 0], [0, -1, 0], [0, 0, 1]];
  const K: M3 = [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]];
  const K2 = mul(K, K), f = (1 - c) / s2;
  return [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) + K[i][j] + K2[i][j] * f)) as M3;
}
function mul(A: M3, B: M3): M3 { return [0, 1, 2].map(i => [0, 1, 2].map(j => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j])) as M3; }
function transpose(A: M3): M3 { return [0, 1, 2].map(i => [0, 1, 2].map(j => A[j][i])) as M3; }
/* Shape matrix S = R diag(r²) Rᵀ (the ellipsoid is xᵀ S⁻¹ x ≤ 1) */
function shape(p: Extract<Prim, { k: "ell" }>, inverse: boolean): M3 {
  const R = basisFor(p.axis), d = p.r.map(r => inverse ? 1 / (r * r) : r * r);
  const RD: M3 = R.map(row => row.map((x, j) => x * d[j])) as M3;
  return mul(RD, transpose(R));
}
function eig2(a: number, b: number, c: number) { // symmetric [[a,b],[b,c]]
  const m = (a + c) / 2, d = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  return { l1: m + d, l2: m - d, angle: 0.5 * Math.atan2(2 * b, a - c) };
}

/* Uniform Catmull–Rom through the control points, sampled densely. three.js renders the same samples. */
export function smoothPath(path: V3[], per = 10): V3[] {
  if (path.length < 3) { const out: V3[] = []; for (let i = 0; i <= per; i++) out.push(lerp3(path[0], path[path.length - 1], i / per)); return out; }
  const out: V3[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const p0 = path[Math.max(0, i - 1)], p1 = path[i], p2 = path[i + 1], p3 = path[Math.min(path.length - 1, i + 2)];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)) as V3);
    }
  }
  out.push(path[path.length - 1]);
  return out;
}
export function ringPoints(p: Extract<Prim, { k: "ring" }>, n = 32): V3[] {
  const a = norm(p.n), t = norm(Math.abs(a[1]) < 0.9 ? cross(a, [0, 1, 0]) : cross(a, [1, 0, 0])), u = cross(a, t);
  return Array.from({ length: n + 1 }, (_, i) => { const th = i / n * Math.PI * 2; return [0, 1, 2].map(k => p.c[k] + p.R * (Math.cos(th) * t[k] + Math.sin(th) * u[k])) as V3; });
}
export function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function densify(pts: V3[], step: number): V3[] {
  const out: V3[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) { const n = Math.max(1, Math.ceil(len(sub(pts[i], pts[i - 1])) / step)); for (let s = 1; s <= n; s++) out.push(lerp3(pts[i - 1], pts[i], s / n)); }
  return out;
}

/* ---------------- Axial slice at height y ---------------- */
export type Ellipse = { cx: number; cy: number; rx: number; ry: number; rot: number }; // 2D, degrees
export type SliceShape = { id: string; ellipses: Ellipse[]; discs: { x: number; z: number; r: number }[]; c: [number, number] };
export function sliceStructure(s: Structure, y: number): SliceShape | null {
  const ellipses: Ellipse[] = [], discs: { x: number; z: number; r: number }[] = [];
  for (const p of s.prims) {
    if (p.k === "cyl") { if (Math.abs(y - p.c[1]) <= p.h) ellipses.push({ cx: p.c[0], cy: p.c[2], rx: p.rx, ry: p.rz, rot: 0 }); continue; }
    if (p.k === "ell") { const e = sliceEllipsoid(p, y); if (e) ellipses.push(e); continue; }
    const pts = p.k === "tube" ? densify(smoothPath(p.path), p.r * 0.4) : densify(ringPoints(p), p.r * 0.6);
    for (const q of pts) { const dy = q[1] - y; if (Math.abs(dy) < p.r) discs.push({ x: q[0], z: q[2], r: Math.sqrt(p.r * p.r - dy * dy) }); }
  }
  if (!ellipses.length && !discs.length) return null;
  const xs = [...ellipses.map(e => [e.cx, e.cy, e.rx * e.ry]), ...discs.map(d => [d.x, d.z, d.r * d.r])];
  const w = xs.reduce((a, b) => a + b[2], 0) || 1;
  return { id: s.id, ellipses, discs, c: [xs.reduce((a, b) => a + b[0] * b[2], 0) / w, xs.reduce((a, b) => a + b[1] * b[2], 0) / w] };
}
/* Plane y = h through the ellipsoid (p−c)ᵀQ(p−c) ≤ 1: in (u, w) = (x−cx, z−cz) it is vᵀqv + 2bᵀv + Qyy·dy² ≤ 1. */
export function sliceEllipsoid(p: Extract<Prim, { k: "ell" }>, h: number): Ellipse | null {
  const Q = shape(p, true), dy = h - p.c[1];
  const a = Q[0][0], b = Q[0][2], c = Q[2][2], bx = Q[0][1] * dy, bz = Q[2][1] * dy;
  const det = a * c - b * b; if (det <= 0) return null;
  const v0x = -(c * bx - b * bz) / det, v0z = -(-b * bx + a * bz) / det;
  const k = 1 - Q[1][1] * dy * dy + (bx * -v0x + bz * -v0z);
  if (k <= 1e-6) return null;
  const { l1, l2, angle } = eig2(a, b, c);
  return { cx: p.c[0] + v0x, cy: p.c[2] + v0z, rx: Math.sqrt(k / l1), ry: Math.sqrt(k / l2), rot: angle * 180 / Math.PI };
}
export function slice(m: Model, y: number): SliceShape[] {
  return m.structures.map(s => sliceStructure(s, y)).filter((x): x is SliceShape => !!x);
}
export const inSlice = (m: Model, id: string, y: number) => !!sliceStructure(structureOf(m, id)!, y);

/* ---------------- Anterior projection (2D fallback view) ---------------- */
export type Proj = { id: string; z: number; ellipses: Ellipse[]; strokes: { d: string; w: number }[] };
export function project(s: Structure): Proj {
  const ellipses: Ellipse[] = [], strokes: { d: string; w: number }[] = []; let zs = 0, n = 0;
  for (const p of s.prims) {
    if (p.k === "ell") {
      const S = shape(p, false); const { l1, l2, angle } = eig2(S[0][0], S[0][1], S[1][1]);
      ellipses.push({ cx: p.c[0], cy: -p.c[1], rx: Math.sqrt(l1), ry: Math.sqrt(l2), rot: -angle * 180 / Math.PI }); zs += p.c[2]; n++;
    } else if (p.k === "cyl") { ellipses.push({ cx: p.c[0], cy: -p.c[1], rx: p.rx, ry: p.h, rot: 0 }); zs += p.c[2]; n++; }
    else {
      const pts = p.k === "tube" ? smoothPath(p.path) : ringPoints(p);
      strokes.push({ d: "M" + pts.map(q => `${q[0].toFixed(2)} ${(-q[1]).toFixed(2)}`).join("L"), w: p.k === "tube" ? p.r * 2 : p.r * 2.4 });
      zs += pts.reduce((a, q) => a + q[2], 0) / pts.length; n++;
    }
  }
  return { id: s.id, z: zs / Math.max(1, n), ellipses, strokes };
}
/* Points on a structure, used to find a screen point that picks it (test hook and pins). */
export function samplePoints(s: Structure): V3[] {
  const out: V3[] = [s.anchor];
  for (const p of s.prims) {
    if (p.k === "ell") { const R = basisFor(p.axis); out.push(p.c); for (const f of [0.6, 0.85]) for (let j = 0; j < 3; j++) for (const sg of [1, -1]) out.push([0, 1, 2].map(k => p.c[k] + sg * f * p.r[j] * R[k][j]) as V3); }
    else if (p.k === "cyl") out.push(p.c, [p.c[0], p.c[1], p.c[2] + p.rz]);
    else if (p.k === "tube") out.push(...smoothPath(p.path, 4));
    else out.push(...ringPoints(p, 12));
  }
  return out;
}

/* ---------------- Vertebral levels ---------------- */
export const levelCenter = (n: number) => Y(n);
export function levelAt(y: number): { n: number; label: string; disc: boolean } {
  const u = 4.5 - y / 2.4, n = Math.round(u);
  const disc = Math.abs(u - n) > 0.95 / 2.4;
  if (n < 1) return { n: 1, label: "above T1", disc: false };
  if (n > 12) return { n: 12, label: "below T12", disc: false };
  if (disc) { const a = Math.floor(u), b = a + 1; return { n, label: a >= 1 && b <= 12 ? `T${a}/T${b} disc` : `T${n}`, disc: true }; }
  return { n, label: `T${n}`, disc: false };
}
export const parseLevel = (s: string) => { const m = /^T([1-9]|1[0-2])$/.exec(s); return m ? Number(m[1]) : 0; };
export function yRange(m: Model): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const s of m.structures) for (const q of samplePoints(s)) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); }
  if (m.vertebrae) { lo = Math.min(lo, Y(12) - 1); hi = Math.max(hi, Y(1) + 1); }
  return [Math.floor(lo), Math.ceil(hi)];
}
/* Landmarks shown when the plane is at that level. These are the traditional teaching levels (Moore ch. 4/5); a supine
   adult CT series (Mirjalili et al., Clin Anat 2012) found the carina, arch and azygos termination mostly at T5–T6 and
   the caval and esophageal openings mostly at T11, so every note says it is the teaching level. */
export const LEVEL_NOTES: Record<number, string> = {
  4: "T4: the aortic arch. In the traditional teaching levels the sternal angle plane (T4/T5 disc) is where the arch begins and ends and the trachea divides.",
  8: "T8: the traditional level of the caval opening, where the inferior vena cava passes through the diaphragm and enters the right atrium.",
  10: "T10: the traditional level of the esophageal hiatus.",
  12: "T12: the traditional level of the aortic hiatus, where the aorta leaves the thorax behind the diaphragm.",
};
/* Shown on the section card and in every section share. */
export const CT_LEVELS_CAVEAT = "This schematic uses traditional teaching levels. The carina is drawn at T4/T5 and the caval, esophageal and aortic openings at T8, T10 and T12. On CT, identify the structures directly. Their vertebral levels vary.";

/* ---------------- Blood-flow tracing ---------------- */
export const edges = (m: Model, from: string) => m.flow.filter(e => e[0] === from).map(e => e[1]);
export const isEdge = (m: Model, a: string, b: string) => m.flow.some(e => e[0] === a && e[1] === b);
/* Patent foramen ovale: 263 of 965 autopsy hearts (27.3%), Hagen, Scholz & Edwards, Mayo Clin Proc 1984. */
const pairs: Record<string, string> = {
  "rightAtrium>leftAtrium": "In this model the atrial septum is closed. After birth the flap of the foramen ovale normally closes functionally, leaving the fossa ovalis. It remains anatomically patent in about a quarter of people. Follow the tricuspid valve here.",
  "leftAtrium>rightAtrium": "In this model the atrial septum is closed. After birth the flap of the foramen ovale normally closes functionally, leaving the fossa ovalis. It remains anatomically patent in about a quarter of people. Follow the mitral valve here.",
  "rightVentricle>leftVentricle": "The interventricular septum is complete, so the two ventricles don't connect. The right ventricle sends blood to the lungs.",
  "leftVentricle>rightVentricle": "The interventricular septum is complete, so the two ventricles don't connect.",
  "pulmonaryTrunk>aorta": "Before birth the ductus arteriosus joined these two. After birth it closes and becomes the ligamentum arteriosum, so blood in the pulmonary trunk goes on to the lungs.",
  "pulmonaryArteries>leftAtrium": "The pulmonary arteries end in the lungs' capillaries. Blood comes back from the lungs in the pulmonary veins, and they drain into the left atrium.",
  "pulmonaryVeins>rightAtrium": "The pulmonary veins drain into the left atrium (the most posterior chamber), not the right.",
  "pulmonaryArteries>pulmonaryTrunk": "That's backwards. Normal forward flow is pulmonary trunk → pulmonary arteries: they are one continuous vessel with no valve between them, and pressure from the right ventricle drives blood outward to the lungs. The pulmonary valve at the right ventricle's outlet closes when the pressure gradient reverses.",
};
const into = (m: Model, id: string) => m.flow.filter(e => e[1] === id).map(e => e[0]);
/* `dest` is the last structure of the route, used when the learner picks a real branch that this route doesn't take. */
export function wrongTurn(m: Model, from: string, to: string, next: string | undefined, triesHere: number, dest?: string): string {
  const fromN = theName(m, from), toN = theName(m, to);
  if (from === to) return `The token is already in ${fromN}.`;
  const key = pairs[`${from}>${to}`];
  if (key) return key + (triesHere >= 2 && next ? ` Next comes ${theName(m, next)}.` : "");
  const sTo = structureOf(m, to), sFrom = structureOf(m, from);
  let why: string;
  if (isEdge(m, to, from)) {
    /* A valve closes when pressure downstream of it rises above pressure upstream (the gradient reverses). */
    const down = sFrom?.tone === "valve" ? edges(m, from)[0] : undefined, up = sTo?.tone === "valve" ? into(m, to)[0] : undefined;
    why = sFrom?.tone === "valve" && down ? `That's backwards. ${cap(fromN)} closes when pressure in ${theName(m, down)} rises above pressure in ${toN}, so blood can't flow back into ${toN}.`
      : sTo?.tone === "valve" && up ? `That's backwards. ${cap(toN)} closes when pressure in ${fromN} rises above pressure in ${theName(m, up)}, so blood can't flow back through it.`
      : `That's backwards: blood flows from ${toN} into ${fromN}, not the other way.`;
  } else if (isEdge(m, from, to)) {
    /* A real outgoing branch that this route doesn't take (RCA from the aorta, circumflex from the left main). */
    const via = next ? ` For this route${dest && dest !== next ? ` to ${theName(m, dest)}` : ""}, follow ${theName(m, next)}.` : "";
    why = (sTo?.tone === "coronary" ? `${cap(toN)} also arises from ${fromN}.` : `Blood can also go from ${fromN} to ${toN}.`) + via;
    return why;
  } else if (next && isEdge(m, next, to)) {
    why = `Close, but you skipped a step. Blood can't reach ${toN} from ${fromN} without passing through ${theName(m, next)} first.`;
  } else if (sTo?.tone === "valve" && /^(tricuspid|mitral)/.test(to) && /^(right|left)Atrium/.test(from)) {
    why = from === "rightAtrium" ? "The mitral valve is on the left side, between the left atrium and left ventricle. The right atrium empties through the tricuspid valve (‘tri’ on the right)." : "The tricuspid valve is on the right side. The left atrium empties through the mitral valve.";
  } else if (from === "rightVentricle" && (to === "aorticValve" || to === "aorta")) {
    why = "The right ventricle pumps to the lungs, through the pulmonary valve into the pulmonary trunk. The aorta leaves the left ventricle.";
  } else if (from === "leftVentricle" && (to === "pulmonaryValve" || to === "pulmonaryTrunk")) {
    why = "The left ventricle pumps to the body, through the aortic valve into the aorta. The pulmonary trunk leaves the right ventricle.";
  } else if ((from === "superiorVenaCava" || from === "inferiorVenaCava") && to !== "rightAtrium") {
    why = "Both venae cavae drain into the right atrium.";
  } else {
    why = edges(m, from).length ? "That is not the next structure on this route." : `${cap(fromN)} is the end of this route.`;
  }
  return why + (triesHere >= 2 && next ? ` Next comes ${theName(m, next)}.` : "");
}
export function stepNote(m: Model, from: string, to: string): string {
  if (from === "pulmonaryArteries" && to === "pulmonaryVeins") return "Through the lungs' capillaries (not shown), where the blood picks up oxygen, and back in the pulmonary veins.";
  const t = structureOf(m, to);
  if (t?.tone === "valve") return `Through ${theName(m, to)}.`;
  return `Into ${theName(m, to)}.`;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/* ---------------- WebGL probe ----------------
   Plain canvas.getContext probing, no three.js import, so the component can decide before it imports the lazy
   three.js chunk (view3d.ts). Call only after mount: it touches document. */
export function webglAvailable(): boolean {
  try {
    if (import.meta.env.DEV && (window as unknown as { __keatingNoWebGL?: boolean }).__keatingNoWebGL) return false;
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

/* ---------------- Config ---------------- */
export type Anatomy3DMode = "explore" | "label" | "section" | "trace";
export type Anatomy3DConfig = {
  model: ModelId;
  mode: Anatomy3DMode;
  targets?: string[];
  route?: string[];
  question?: string;
  level?: string;
  title?: string;
};
const KEYS = ["model", "mode", "targets", "route", "question", "level", "title"];
const MODES: Anatomy3DMode[] = ["explore", "label", "section", "trace"];
export function validate(config: unknown): string[] {
  try { return validateInner(config); } catch { return ["config could not be read"]; }
}
function validateInner(config: unknown): string[] {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return ["config must be an object"];
  const c = config as Record<string, unknown>, errs: string[] = [];
  for (const k of Object.keys(c)) if (!KEYS.includes(k)) errs.push(`unknown field "${k}"`);
  if (typeof c.model !== "string" || !MODEL_IDS.includes(c.model as ModelId)) return [...errs, `model must be one of ${MODEL_IDS.join(", ")}`];
  if (typeof c.mode !== "string" || !MODES.includes(c.mode as Anatomy3DMode)) return [...errs, `mode must be one of ${MODES.join(", ")}`];
  const m = getModel(c.model as ModelId), mode = c.mode as Anatomy3DMode;
  const ids = (v: unknown, field: string, min: number, max: number): string[] | null => {
    if (!Array.isArray(v)) { errs.push(`${field} must be an array of structure ids`); return null; }
    if (v.length < min || v.length > max) errs.push(`${field} needs ${min}–${max} entries`);
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== "string") { errs.push(`${field} entries must be strings`); return null; }
      if (!structureOf(m, x)) errs.push(`"${x}" is not a structure in the ${m.id} model`);
      out.push(x);
    }
    if (new Set(out).size !== out.length) errs.push(`${field} has duplicates`);
    return out;
  };
  for (const f of ["question", "title"] as const) if (c[f] !== undefined && (typeof c[f] !== "string" || !(c[f] as string).trim() || (c[f] as string).length > (f === "title" ? 60 : 200))) errs.push(`${f} must be a non-empty string of at most ${f === "title" ? 60 : 200} characters`);
  if (c.route !== undefined && mode !== "trace") errs.push("route is only used in trace mode");
  if (c.level !== undefined && mode !== "section") errs.push("level is only used in section mode");
  let level = 0;
  if (c.level !== undefined) {
    level = typeof c.level === "string" ? parseLevel(c.level) : 0;
    if (!level) errs.push(`level must be "T1"…"T12"`);
    else { const [lo, hi] = yRange(m), y = Y(level); if (y < lo || y > hi) errs.push(`level ${c.level} is outside the ${m.id} model`); }
  }
  if (mode === "trace") {
    if (c.route === undefined) errs.push("trace mode needs a route");
    else { const r = ids(c.route, "route", 2, 16); if (r && r.every(x => structureOf(m, x))) for (let i = 1; i < r.length; i++) if (!isEdge(m, r[i - 1], r[i])) errs.push(`${r[i - 1]} → ${r[i]} is not a blood-flow step in this model`); }
    if (c.targets !== undefined) errs.push("targets are not used in trace mode");
  } else if (c.targets !== undefined || mode === "label") {
    if (c.targets === undefined) errs.push("label mode needs targets");
    else {
      const t = ids(c.targets, "targets", mode === "label" ? 2 : 1, mode === "label" ? 10 : 8);
      if (t && level && mode === "section") for (const x of t) if (structureOf(m, x) && !inSlice(m, x, Y(level))) errs.push(`"${x}" is not in the slice at T${level}`);
    }
  }
  return errs;
}

/* ---------------- Share text (scripted, from what the learner did) ---------------- */
export type Attempt = { label: string; on: string; ok: boolean };
export type Turn = { from: string; to: string; why: string };
export type Progress = {
  mode: Anatomy3DMode; placed: string[]; attempts: Attempt[]; path: string[]; turns: Turn[];
  planeY: number; planeMoved: boolean; inspected: string[]; pulled: string[];
};
export type ShareSummary = { learner: string; data: string; reply: string };
const list = (xs: string[]) => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const num = (n: number) => NUM[n] ?? String(n);
const withCaveat = (cfg: Anatomy3DConfig, r: ShareSummary): ShareSummary => cfg.mode === "section" ? { ...r, reply: `${r.reply} ${CT_LEVELS_CAVEAT}` } : r;
export function hasActed(p: Progress) { return p.attempts.length > 0 || p.path.length > 1 || p.turns.length > 0 || p.planeMoved || p.inspected.length > 0 || p.pulled.length > 0; }
export function summarize(m: Model, cfg: Anatomy3DConfig, p: Progress): ShareSummary {
  const N = (id: string) => nameOf(m, id), n = (id: string) => "the " + lower(N(id));
  const wrong = p.attempts.filter(a => !a.ok);
  const level = levelAt(p.planeY).label;
  if (cfg.mode === "label" || cfg.mode === "section") {
    const targets = cfg.targets ?? [];
    const firstTry = targets.filter(t => p.placed.includes(t) && !wrong.some(w => w.label === t));
    const data = `${cfg.mode === "section" ? `Plane at ${level}. ` : ""}Labelled ${p.placed.length}/${targets.length}` +
      (p.placed.length ? `: ${p.placed.map(N).join(", ")}` : "") + (wrong.length ? `. Wrong drops: ${wrong.map(w => `${N(w.label)} → ${n(w.on)}`).join("; ")}` : "");
    if (!p.attempts.length) {
      return withCaveat(cfg, { learner: cfg.mode === "section" ? `I moved the plane to ${level}.` : "I've had a look but haven't placed a label yet.", data,
        reply: cfg.mode === "section" ? `At ${level} the slice shows ${list(slice(m, p.planeY).filter(s => !["rightLung", "leftLung"].includes(s.id)).map(s => n(s.id)))}. ${cfg.level && level !== cfg.level ? `The question asks about ${cfg.level}, so drag the plane there next, then drag the names onto the slice.` : "Try dragging the names onto the slice."}`
          : "Nothing is labelled yet. Start with the one you're surest of. Each wrong drop tells you which structure you hit, which is useful too." });
    }
    const swaps = wrong.filter(w => targets.includes(w.on));
    const parts: string[] = [];
    if (p.placed.length === targets.length) parts.push(wrong.length ? `All ${num(targets.length)} are on now, ${num(firstTry.length)} of them first time.` : `All ${num(targets.length)} on the first try.`);
    else parts.push(`${cap(num(p.placed.length))} of ${num(targets.length)} placed so far${p.placed.length ? ` (${list(p.placed.map(n))})` : ""}.`);
    const avAvsSemi = swaps.filter(w => [w.label, w.on].every(x => /tricuspid|mitral/.test(x)));
    const semis = swaps.filter(w => [w.label, w.on].every(x => /pulmonaryValve|aorticValve/.test(x)));
    const sides = swaps.filter(w => /^(right|left)(Atrium|Ventricle)$/.test(w.label) && /^(right|left)(Atrium|Ventricle)$/.test(w.on));
    if (avAvsSemi.length) parts.push("You swapped the mitral and tricuspid valves. They're the atrioventricular valves: tricuspid on the right (‘tri’ and ‘right’), mitral on the left, and the mitral is the most posterior valve.");
    if (semis.length) parts.push("You swapped the two semilunar valves. The pulmonary valve is the higher and more anterior one, at the top of the right ventricle. The aortic valve is behind it and to the right, at the centre of the heart.");
    if (sides.length) parts.push(`You put ${list(sides.map(w => n(w.label)))} on ${list(sides.map(w => n(w.on)))}. In the anterior view the patient's right is on your left, and the right ventricle forms most of the front of the heart while the left atrium is the most posterior chamber.`);
    const others = wrong.filter(w => !avAvsSemi.includes(w) && !semis.includes(w) && !sides.includes(w));
    if (others.length) parts.push(`${others.map(w => `${N(w.label)} went first on ${n(w.on)}`).join("; ")}. ${structureOf(m, others[0].label) ? `${cap(n(others[0].label))} is ${structureOf(m, others[0].label)!.hint}.` : ""}`);
    if (cfg.mode === "section" && cfg.level && level !== cfg.level) parts.push(`Your plane is at ${level}; the question was about ${cfg.level}.`);
    if (p.placed.length === targets.length && !wrong.length) parts.push(cfg.mode === "section" ? "Next, try a level higher or lower and predict what will appear before you look." : "Next, try tracing blood through them in order, from the venae cavae to the aorta.");
    return withCaveat(cfg, { learner: p.placed.length === targets.length ? `I labelled all ${num(targets.length)}.` : `I've labelled ${num(p.placed.length)} of ${num(targets.length)} so far.`, data, reply: parts.join(" ") });
  }
  if (cfg.mode === "trace") {
    const route = cfg.route ?? [], done = p.path.length - 1, total = route.length - 1;
    const data = `Reached ${N(p.path[p.path.length - 1])} (${done}/${total} steps). Path: ${p.path.map(N).join(" → ")}` + (p.turns.length ? `. Wrong turns: ${p.turns.map(t => `${N(t.from)} → ${n(t.to)}`).join("; ")}` : "");
    const parts: string[] = [];
    parts.push(done === total ? `You took the blood all the way from ${n(route[0])} to ${n(route[route.length - 1])}${p.turns.length ? "" : " without a wrong turn"}.` : `You've got as far as ${n(p.path[p.path.length - 1])}, ${num(done)} of ${num(total)} steps.`);
    if (!p.turns.length && done === 0) parts.push("You haven't moved the token yet.");
    for (const t of p.turns.slice(0, 3)) parts.push(`From ${n(t.from)} you tried ${n(t.to)}: ${t.why.replace(/ Next comes .*$/, "")}`);
    if (done === total) parts.push("Notice the pattern: every chamber is followed by a valve. Atria empty through the atrioventricular valves (tricuspid, mitral); ventricles empty through the semilunar valves (pulmonary, aortic).");
    return { learner: done === total ? "I traced the blood all the way through." : `I traced the blood as far as ${n(p.path[p.path.length - 1])}.`, data, reply: parts.join(" ") };
  }
  const data = `Inspected: ${p.inspected.map(N).join(", ") || "none"}. Pulled apart: ${p.pulled.map(N).join(", ") || "none"}.`;
  const last = p.inspected[p.inspected.length - 1];
  return {
    learner: p.inspected.length ? `I looked at ${list(p.inspected.slice(-3).map(n))}.` : `I pulled ${list(p.pulled.slice(-3).map(n))} out to see behind ${p.pulled.length > 1 ? "them" : "it"}.`,
    data,
    reply: (last ? `${N(last)}: ${structureOf(m, last)?.info} ` : "") + (cfg.question ? `Back to your question: ${cfg.question} Which structure on the model answers it?` : "Want me to turn this into a quick label quiz?"),
  };
}
