import { createHash } from "node:crypto";
import { createClient } from "redis";

export type RankEdit = {
  key: string;
  before: string | null;
  value?: string;
  ttl?: number;
};

export type SubjectScore = { key: string; member: string; score?: number; ttl: number };
export interface HabitRankingsStore {
  get(key: string): Promise<string | null>;
  compareAndSet(edits: readonly RankEdit[], scores: readonly SubjectScore[]): Promise<boolean>;
  leaders(key: string): Promise<{ member: string; score: number }[]>;
}

// Compare every account/cohort key read by the transition before updating it.
// Subject boards are updated in the same commit so withdrawal is immediate on every board.
const COMMIT = `
local edits = cjson.decode(ARGV[1])
local scores = cjson.decode(ARGV[2])
for i, edit in ipairs(edits) do
  local actual = redis.call('GET', KEYS[i])
  if (edit.before == cjson.null and actual ~= false) or
     (edit.before ~= cjson.null and actual ~= edit.before) then return 0 end
end
for i, edit in ipairs(edits) do
  if edit.value ~= nil then
    if edit.ttl ~= nil then
      redis.call('SET', KEYS[i], edit.value, 'EX', edit.ttl)
    else
      redis.call('SET', KEYS[i], edit.value)
    end
  end
end
for i, score in ipairs(scores) do
  local key = KEYS[#edits + i]
  if score.score == nil then
    redis.call('ZREM', key, score.member)
  else
    redis.call('ZADD', key, score.score, score.member)
    redis.call('EXPIRE', key, score.ttl)
  end
end
return 1`;

export class RedisHabitRankingsStore implements HabitRankingsStore {
  private readonly client;
  private readonly prefix: string;
  private connecting?: Promise<void>;

  constructor(url: string, namespace: string) {
    const partition = createHash("sha256").update(namespace).digest("hex").slice(0, 16);
    this.prefix = `keating:habit-rankings:v1:{${partition}}:`;
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      socket: { connectTimeout: 1500, reconnectStrategy: retries => Math.min(1000, 100 * (retries + 1)) },
    });
    this.client.on("error", () => {});
  }

  private async run<T>(command: () => Promise<T>): Promise<T> {
    if (!this.client.isOpen) {
      this.connecting ??= this.client.connect().then(() => {}).finally(() => { this.connecting = undefined; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          await this.connecting;
          if (!this.client.isReady) throw new Error("Rankings storage unavailable.");
          return command();
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Rankings storage timed out.")), 2500);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  get(key: string): Promise<string | null> {
    return this.run(() => this.client.get(this.prefix + key));
  }

  async compareAndSet(edits: readonly RankEdit[], scores: readonly SubjectScore[]): Promise<boolean> {
    const keys = [...edits, ...scores].map(edit => this.prefix + edit.key);
    const result = await this.run(() => this.client.eval(COMMIT, {
      keys,
      arguments: [JSON.stringify(edits), JSON.stringify(scores)],
    }));
    return result === 1;
  }

  async leaders(key: string): Promise<{ member: string; score: number }[]> {
    const rows = await this.run(() => this.client.zRangeWithScores(this.prefix + key, 0, 29, { REV: true }));
    return rows.map(({ value, score }) => ({ member: value, score }));
  }

  close(): void {
    if (this.client.isOpen) this.client.destroy();
  }
}

let live: { config: string; store: RedisHabitRankingsStore } | undefined;
export function getHabitRankingsStore(): HabitRankingsStore {
  const config = process.env.KEATING_ABUSE_REDIS_URL;
  if (!config) throw new Error("Rankings storage is not configured.");
  if (live?.config !== config) {
    live?.store.close();
    const namespace = process.env.RAILWAY_ENVIRONMENT_ID ?? "local";
    live = { config, store: new RedisHabitRankingsStore(config, namespace) };
  }
  return live.store;
}
