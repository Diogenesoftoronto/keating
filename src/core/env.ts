import * as dotenv from "dotenv";

const DEBUG_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

function envFlagEnabled(value: string | undefined): boolean {
  return value !== undefined && DEBUG_ENV_VALUES.has(value.toLowerCase());
}

export function loadEnv(): void {
  const debug = envFlagEnabled(process.env.KEATING_DEBUG) || envFlagEnabled(process.env.DEBUG);
  dotenv.config({ debug, quiet: !debug });
}
