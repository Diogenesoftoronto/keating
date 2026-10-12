/** Public, owner-authored summary. Never pass a learner record or transcript here. */
export const LEARNING_PROFILE_COLLECTION = "app.keating.learningProfile";
export const LEARNING_PROFILE_SCOPE = `atproto repo:${LEARNING_PROFILE_COLLECTION}`;
export const LEARNING_PROFILE_PATH = "/review/learning-profile";

export interface PublicLearningProfile {
  $type: typeof LEARNING_PROFILE_COLLECTION;
  schemaVersion: 1;
  visibility: "public";
  publicationId: string;
  topics: string[];
  activity?: { savedSessions: number };
  updatedAt: string;
}

interface PrivateLearningProfile {
  $type: typeof LEARNING_PROFILE_COLLECTION;
  schemaVersion: 1;
  visibility: "private";
  publicationId: string;
  updatedAt: string;
}

export function learningProfileRecord(topics: unknown, savedSessions?: unknown, now = new Date()): PublicLearningProfile {
  if (!Array.isArray(topics) || topics.length > 20) throw new Error("Choose at most 20 public topic labels.");
  const labels = topics.map((topic) => {
    if (typeof topic !== "string" || !topic.trim() || topic.trim().length > 80 || /[\u0000-\u001f\u007f]/u.test(topic)) {
      throw new Error("Each topic must be a short label of 1–80 characters on one line.");
    }
    return topic.trim();
  });
  if (new Set(labels.map(label => label.toLocaleLowerCase())).size !== labels.length) throw new Error("Remove duplicate topic labels.");
  if (savedSessions !== undefined && (!Number.isSafeInteger(savedSessions) || (savedSessions as number) < 0)) {
    throw new Error("The saved-session count is invalid.");
  }
  return {
    $type: LEARNING_PROFILE_COLLECTION,
    schemaVersion: 1,
    visibility: "public",
    publicationId: crypto.randomUUID(),
    topics: labels,
    ...(savedSessions === undefined ? {} : { activity: { savedSessions: savedSessions as number } }),
    updatedAt: now.toISOString(),
  };
}

export function readLearningProfile(value: unknown): PublicLearningProfile {
  if (!value || typeof value !== "object") throw new Error("The public profile could not be read.");
  const record = value as Record<string, unknown>;
  if (record.$type !== LEARNING_PROFILE_COLLECTION || record.schemaVersion !== 1 || record.visibility !== "public" || typeof record.publicationId !== "string" || !record.publicationId || typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) {
    throw new Error("This public profile uses an unsupported format.");
  }
  if (record.activity !== undefined && (!record.activity || typeof record.activity !== "object" || !Object.hasOwn(record.activity, "savedSessions"))) {
    throw new Error("The public activity summary is invalid.");
  }
  return { ...learningProfileRecord(record.topics, (record.activity as { savedSessions?: unknown } | undefined)?.savedSessions, new Date(record.updatedAt)), publicationId: record.publicationId };
}

export interface LearningProfileSession {
  readonly sub: string;
  getTokenInfo(): Promise<{ scope: string }>;
  fetchHandler(path: string, init?: RequestInit): Promise<Response>;
}

/** This accepts only the authenticated account's DID, never a UI-selected repository. */
export class LearningProfilePublisher {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly session: LearningProfileSession, private readonly owner: { did: string; isCurrent(): boolean }) {}

  private assertOwner() {
    if (!this.owner.isCurrent() || !/^did:(plc|web):\S+$/u.test(this.owner.did) || this.session.sub !== this.owner.did) {
      throw new Error("Your accounts do not match. Reconnect the PDS for your current Not Organic account.");
    }
  }

  private async request(method: "GET" | "POST", record?: PublicLearningProfile | PrivateLearningProfile, signal?: AbortSignal, swapRecord?: string | null) {
    this.assertOwner();
    const token = await this.session.getTokenInfo();
    this.assertOwner();
    if (!token.scope.split(/\s+/u).includes(`repo:${LEARNING_PROFILE_COLLECTION}`)) {
      throw new Error("Reconnect your PDS to allow publishing and removing your learning profile.");
    }
    const params = { repo: this.session.sub, collection: LEARNING_PROFILE_COLLECTION, rkey: "self" };
    const path = `/xrpc/com.atproto.repo.${method === "GET" ? "getRecord" : "putRecord"}${method === "GET" ? `?${new URLSearchParams(params)}` : ""}`;
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000);
    requestSignal.throwIfAborted();
    const response = await this.session.fetchHandler(path, {
      method,
      signal: requestSignal,
      redirect: "error",
      ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ ...params, record, swapRecord, validate: false }) } : {}),
    });
    this.assertOwner();
    const text = await response.text();
    if (text.length > 32_000) throw new Error("The PDS returned an oversized response.");
    this.assertOwner();
    const body = JSON.parse(text || "{}") as { error?: string; value?: unknown; cid?: string; uri?: string };
    // Only a confirmed missing record is private. Network/permission failures are unknown.
    if ([400, 404].includes(response.status) && body.error === "RecordNotFound" && method === "GET") return null;
    if (!response.ok && body.error === "InvalidSwap") throw new Error("Your public profile changed in another tab or app. Reload its status and review your choice before retrying.");
    if (!response.ok) throw new Error(`The PDS could not ${record?.visibility === "private" ? "remove" : method === "POST" ? "publish" : "read"} your profile (${response.status}). Its public status may be unchanged; retry to confirm.`);
    if (body.uri !== `at://${this.session.sub}/${LEARNING_PROFILE_COLLECTION}/self` || typeof body.cid !== "string" || !body.cid.trim() || body.cid.length > 200) {
      throw new Error(method === "GET" ? "The PDS returned an invalid record reference. No changes were sent." : "The PDS did not confirm the expected profile revision. Its public status is unknown; reload its status or make it private.");
    }
    return body;
  }

  async read(signal?: AbortSignal): Promise<PublicLearningProfile | null> {
    const result = await this.request("GET", undefined, signal);
    if (result === null) return null;
    if (result.value && typeof result.value === "object") {
      const value = result.value as Record<string, unknown>;
      if (value.$type === LEARNING_PROFILE_COLLECTION && value.schemaVersion === 1 && value.visibility === "private" && typeof value.publicationId === "string" && value.publicationId && !Object.hasOwn(value, "topics") && !Object.hasOwn(value, "activity")) return null;
    }
    return readLearningProfile(result.value);
  }

  private async currentCid(signal?: AbortSignal): Promise<string | null> {
    const result = await this.request("GET", undefined, signal);
    if (result === null) return null;
    if (typeof result.cid !== "string" || !result.cid || result.cid.length > 200) throw new Error("The PDS did not return a valid record revision. No changes were sent.");
    return result.cid;
  }

  publish(input: { topics: unknown; savedSessions?: unknown; consent: boolean }, signal?: AbortSignal): Promise<PublicLearningProfile> {
    if (input.consent !== true) return Promise.reject(new Error("Confirm that these labels and optional count may be public."));
    const record = learningProfileRecord(input.topics, input.savedSessions);
    return this.serialize(async () => {
      const cid = await this.currentCid(signal);
      await this.request("POST", record, signal, cid);
      return record;
    });
  }

  remove(signal?: AbortSignal): Promise<void> {
    return this.serialize(async () => {
      const cid = await this.currentCid(signal);
      // Keep a minimal revision marker. Deleting an absent record cannot invalidate a delayed initial publication.
      const record: PrivateLearningProfile = { $type: LEARNING_PROFILE_COLLECTION, schemaVersion: 1, visibility: "private", publicationId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
      await this.request("POST", record, signal, cid);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.catch(() => {});
    return result;
  }
}
