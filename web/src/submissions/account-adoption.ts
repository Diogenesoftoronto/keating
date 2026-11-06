import { localRead, localWrite } from "./local-store";

/** Written only from the same-origin bridge's provider-verified adoption receipt. */
export async function recordCourseAccountAdoptions(sources: unknown, accountId: string): Promise<void> {
  if (!Array.isArray(sources) || !accountId.startsWith("did:")) return;
  for (const source of sources) {
    if (typeof source !== "string" || !/^local_[0-9a-f]{64}$/.test(source)) continue;
    const key = `course-account-adoption:${source}`;
    const prior = await localRead<string>("tasks", key);
    if (prior && prior !== accountId) throw new Error("This device's course drafts are already linked to another account.");
    await localWrite("tasks", key, accountId);
  }
}

export async function adoptedCourseAccount(accountId: string): Promise<string> {
  if (!/^local_[0-9a-f]{64}$/.test(accountId)) return accountId;
  return await localRead<string>("tasks", `course-account-adoption:${accountId}`) ?? accountId;
}
