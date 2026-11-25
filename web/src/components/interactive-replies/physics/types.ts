/* PhysicsLab config types. Plain JSON so a model can author them. */
export type ShareSummary = { learner: string; data: string; reply: string };

export type FieldFinding = "oneArrow" | "nullPoint" | "superposition" | "inverseSquare" | "shielding";
export type FieldConfig = {
  mode: "field"; title: string; goal?: string;
  units: { length: "mm" | "cm" | "m"; charge: "nC" | "µC" };
  /** Visible plane, centred on the origin, in length units. */
  view: { width: number; height: number };
  charges: { id: string; x: number; y: number; q: number; locked?: boolean }[];
  /** A neutral (or grounded) conducting sphere seen in cross-section. Charges stay outside it. */
  conductor?: { x: number; y: number; r: number; grounded?: boolean };
  /** Test charge start position; omit to leave it in its dock. */
  probe?: { x: number; y: number };
  linesPerUnit?: number;            // field lines per unit of charge (default 6)
  qStep?: number; qMax?: number;    // charge handle step (default 1) and |q| limit (default 4)
  maxCharges?: number;              // ≤ 6; > charges.length shows the + / − dock
  show?: { lines?: boolean; equipotentials?: boolean; potentialMap?: boolean };
  findings?: FieldFinding[];
};

export type WaveFinding = "bright" | "dark" | "spacing" | "width" | "separation";
export type WavesConfig = {
  mode: "waves"; title: string; goal?: string;
  units: { length: "nm" | "µm" | "mm" | "cm" | "m" };
  wavelength: { value: number; min: number; max: number; step?: number };
  scene:
    | { kind: "sources"; sources: { id: string; x: number; y: number }[] }
    | { kind: "slits"; barrierX: number; slits: { id: string; y: number; width: number }[]; minWidth?: number; maxWidth?: number };
  screen: { x: number; min: number; max: number };
  /** Visible region: x from x0 to x1, y from −yHalf to yHalf. */
  view: { x0: number; x1: number; yHalf: number };
  scaleNote?: string;
  /** Wave speed in m/s for sound (length unit m only): the note then shows f = c/λ live. */
  soundSpeed?: number;
  findings?: WaveFinding[];
};

export type PotentialSpec =
  | { kind: "infinite"; left: number; right: number }
  | { kind: "finiteSquare"; left: number; right: number; depth: number }
  | { kind: "harmonic"; hw: number; center?: number }
  | { kind: "doubleWell"; barrier: number; separation: number; center?: number }
  | { kind: "barrier"; left: number; right: number; height: number }
  | { kind: "points"; points: [number, number][] };
export type QuantumFinding = "zeroPoint" | "forbidden" | "evenSpacing" | "splitting" | "tunnels" | "exponential" | "reflectsAbove" | "resonance";
export type QuantumConfig = {
  mode: "quantum"; title: string; goal?: string;
  /** natural: ℏ = m = 1. electron: an electron, energies in eV, lengths in nm, times in fs. */
  units: "natural" | "electron";
  view: "bound" | "tunnel";
  domain: [number, number];
  energyRange: [number, number];
  potential: PotentialSpec;
  /** Tunnel view: incident energy. */
  energy?: { value: number; min: number; max: number };
  states?: number;              // levels drawn (bound view, default 6, ≤ 12)
  selected?: number;            // 1-based level selected at start
  /** finiteSquare only: a depth axis with the bound-state-count bands, 0..max. */
  depthAxis?: { max: number };
  /** Tunnel view: T against barrier width, 0..max. */
  widthAxis?: { max: number };
  findings?: QuantumFinding[];
};

export type PhysicsConfig = FieldConfig | WavesConfig | QuantumConfig;
