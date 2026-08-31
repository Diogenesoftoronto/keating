import { StateValidationError } from "./errors";
import type { JsonValue } from "./types";

const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function assertJsonValue(value: unknown, path = "value", seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new StateValidationError(`${path} must contain only finite numbers.`);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new StateValidationError(`${path} may not contain a cycle.`);
    seen.add(value);
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new StateValidationError(`${path} must be JSON-compatible plain data.`);
  }
  if (seen.has(value)) throw new StateValidationError(`${path} may not contain a cycle.`);
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) throw new StateValidationError(`${path} contains forbidden key ${key}.`);
    if (entry === undefined) throw new StateValidationError(`${path}.${key} may not be undefined.`);
    assertJsonValue(entry, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export function cloneJson<T extends JsonValue>(value: T): T {
  assertJsonValue(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
