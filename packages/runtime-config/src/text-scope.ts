/** Ordinary inference shares one privacy boundary, not one permission per release.
 * Keep this explicit classification aligned with Not Organic contracts. New or
 * changed processing/retention profiles fail closed until reviewed separately.
 */
export const NOTORGANIC_TEXT_SCOPE = "infer:text";
export const NOTORGANIC_ORDINARY_TEXT_MODELS: readonly string[] = [
  "fast", "balanced", "reasoning", "inkling-small", "inkling-2-small", "inkling",
  "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "deepseek-v4.1-flash", "mercury-3",
];
export function notOrganicInferenceScope(model: string): string {
  return NOTORGANIC_ORDINARY_TEXT_MODELS.includes(model) ? NOTORGANIC_TEXT_SCOPE : `infer:${model}`;
}
/** Legacy exact grants remain useful, without turning them into broader grants. */
export function hasNotOrganicInferenceScope(scopes: ReadonlySet<string>, model: string): boolean {
  return scopes.has(`infer:${model}`)
    || (NOTORGANIC_ORDINARY_TEXT_MODELS.includes(model) && scopes.has(NOTORGANIC_TEXT_SCOPE));
}
