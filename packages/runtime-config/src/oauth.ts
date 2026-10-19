/** Consent follows enabled model IDs; judgement and tabular access remain explicit opt-ins. */
import { DEFAULT_MODELS, NOTORGANIC_CHAT_MODEL_IDS, NOTORGANIC_IMAGE_MODEL_IDS } from "./models.js";

export const NOTORGANIC_CAPABILITIES = [
  "wallet:read", "usage:read", "billing:checkout", "web:search", "web:fetch", "realtime:connect",
] as const;

export interface NotOrganicScopeOptions {
  models: readonly string[];
  capabilities: readonly string[];
}

export function buildNotOrganicScope({ models, capabilities }: NotOrganicScopeOptions): string {
  const explicit = [...new Set(capabilities.map(scope => scope.trim()).filter(Boolean))];
  const inference = [...new Set([
    ...models.map(model => model.trim()).filter(Boolean).map(model => `infer:${model}`),
    ...explicit.filter(scope => scope.startsWith("infer:")),
  ])].sort();
  // Retain the shipped browser scope byte order: account, chat, web, image, realtime.
  // Insert web capabilities at the image boundary without disturbing sorted model scopes.
  const web = explicit.filter(scope => scope.startsWith("web:"));
  const ordered = explicit.filter(scope => /^(wallet|usage|billing):/.test(scope));
  let webInserted = false;
  for (const scope of inference) {
    if (!webInserted && scope >= `infer:${DEFAULT_MODELS.image.notorganic}`) {
      ordered.push(...web);
      webInserted = true;
    }
    ordered.push(scope);
  }
  if (!webInserted) ordered.push(...web);
  ordered.push(...explicit.filter(scope => !/^(wallet|usage|billing|web|infer):/.test(scope)));
  return [...new Set(ordered)].join(" ");
}

export const DEFAULT_NOTORGANIC_SCOPE = buildNotOrganicScope({
  models: [...NOTORGANIC_CHAT_MODEL_IDS, ...NOTORGANIC_IMAGE_MODEL_IDS],
  capabilities: NOTORGANIC_CAPABILITIES,
});
