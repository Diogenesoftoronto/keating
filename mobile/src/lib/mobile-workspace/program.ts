export const MOBILE_PROGRAM_ENTRYPOINT = "screens/home.json";

export type MobileProgramBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "learner-summary" }
  | { type: "review-queue"; limit: number; strategy: "weakest-first" | "due-first" }
  | { type: "action"; label: string; action: "review.start" | "navigation.open"; target?: string };

export interface MobileWorkspaceProgram {
  schemaVersion: 1;
  screen: { type: "stack"; gap: "sm" | "md" | "lg"; children: readonly MobileProgramBlock[] };
}

const BLOCK_KEYS: Record<MobileProgramBlock["type"], readonly string[]> = {
  heading: ["type", "text"],
  paragraph: ["type", "text"],
  "learner-summary": ["type"],
  "review-queue": ["type", "limit", "strategy"],
  action: ["type", "label", "action", "target"],
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function boundedText(value: unknown, maximum = 1_000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

export function validateMobileWorkspaceProgram(value: unknown): value is MobileWorkspaceProgram {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "screen"])
    || value.schemaVersion !== 1 || !isPlainRecord(value.screen)
    || !hasOnlyKeys(value.screen, ["type", "gap", "children"])
    || value.screen.type !== "stack"
    || !["sm", "md", "lg"].includes(String(value.screen.gap))
    || !Array.isArray(value.screen.children)
    || value.screen.children.length < 1 || value.screen.children.length > 24) return false;

  return value.screen.children.every((block) => {
    if (!isPlainRecord(block) || typeof block.type !== "string"
      || !(block.type in BLOCK_KEYS)
      || !hasOnlyKeys(block, BLOCK_KEYS[block.type as MobileProgramBlock["type"]])) return false;
    if (block.type === "heading" || block.type === "paragraph") return boundedText(block.text);
    if (block.type === "learner-summary") return true;
    if (block.type === "review-queue") {
      return Number.isInteger(block.limit) && Number(block.limit) >= 1 && Number(block.limit) <= 50
        && (block.strategy === "weakest-first" || block.strategy === "due-first");
    }
    if (block.type === "action") {
      return boundedText(block.label, 120)
        && (block.action === "review.start" || block.action === "navigation.open")
        && (block.target === undefined || boundedText(block.target, 240));
    }
    return false;
  });
}

export function parseMobileWorkspaceProgram(source: string): MobileWorkspaceProgram {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error(`${MOBILE_PROGRAM_ENTRYPOINT} is not valid JSON.`); }
  if (!validateMobileWorkspaceProgram(value)) {
    throw new Error(`${MOBILE_PROGRAM_ENTRYPOINT} does not match the bounded mobile component schema.`);
  }
  return value;
}

export const DEFAULT_MOBILE_PROGRAM: MobileWorkspaceProgram = Object.freeze({
  schemaVersion: 1,
  screen: Object.freeze({
    type: "stack",
    gap: "md",
    children: Object.freeze([
      Object.freeze({ type: "heading", text: "Your learning" }),
      Object.freeze({ type: "learner-summary" }),
      Object.freeze({ type: "review-queue", limit: 12, strategy: "weakest-first" }),
      Object.freeze({ type: "action", label: "Start review", action: "review.start" }),
    ]),
  }),
});
