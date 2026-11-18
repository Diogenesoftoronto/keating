import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export const here = import.meta.dir,
  root = resolve(here, "../../../..");
export const read = (path) => JSON.parse(readFileSync(path, "utf8"));
export const sha = (value) =>
  createHash("sha256")
    .update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest("hex");
export const must = (value, msg) => {
  if (!value) throw Error(msg);
};
export const usd = (n) => Number(n.toFixed(9));
export const total = (entries) => usd(entries.reduce((s, e) => s + e.accountedUsd, 0));
export const protocol = read(join(here, "protocol.json")),
  original = read(join(here, protocol.cases));
export const cells = [protocol.primaryTutor, protocol.secondaryTutor].flatMap((id) =>
  protocol.order.map((caseId) => ({
    id: id + "--" + caseId,
    model: original.models.find((m) => m.id === id),
    c: original.cases.find((c) => c.id === caseId),
  })),
);
export const fileHash = (path) => sha(readFileSync(path));
export function save(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path + ".tmp", "w");
  try {
    writeFileSync(fd, JSON.stringify(obj, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(path + ".tmp", path);
  const dir = openSync(dirname(path), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export function credential(name, skate) {
  if (process.env[name]) return process.env[name];
  const result = Bun.spawnSync(["rtk", "proxy", "skate", "get", skate + "@secrets"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}
export function verifyPrior() {
  const audit = resolve(here, "..");
  const old =
    total(read(join(audit, "evidence/budget.json"))) +
    [
      "policy-v2/ledger.json",
      "policy-v2.1/ledger.json",
      "policy-holdout/ledger.json",
      "policy-holdout/segment-two-ledger.json",
    ].reduce((s, f) => s + total(read(join(audit, f)).entries), 0);
  must(
    usd(old) === protocol.previousBoundUsd &&
      usd(protocol.allStudyLimitUsd - old) === protocol.incrementalLimitUsd,
    "Prior accounting changed",
  );
  must(fileHash(join(here, protocol.cases)) === protocol.casesSha256, "Original cases changed");
}
export function withSharedLock() {
  if (process.env.KEATING_DECISION_AUDIT_LOCK === "1") return;
  const path = join(root, ".keating/benchmarks/openui-audit-2026-11-18");
  mkdirSync(path, { recursive: true });
  const child = Bun.spawnSync(
    [
      "rtk",
      "proxy",
      "flock",
      "-n",
      "-E",
      "75",
      join(path, ".budget.lock"),
      process.execPath,
      ...process.argv.slice(1),
    ],
    {
      env: { ...process.env, KEATING_DECISION_AUDIT_LOCK: "1" },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  process.exit(child.exitCode ?? 1);
}
export function openJournal() {
  verifyPrior();
  const path = join(here, "ledger.json"),
    protocolSha256 = fileHash(join(here, "protocol.json"));
  const ledger = existsSync(path)
    ? read(path)
    : {
        protocolSha256,
        priorBoundUsd: protocol.previousBoundUsd,
        capUsd: protocol.allStudyLimitUsd,
        stop: null,
        entries: [],
      };
  must(ledger.protocolSha256 === protocolSha256, "Study protocol changed");
  const persist = () => save(path, ledger);
  const stop = (reason) => {
    ledger.stop ??= reason;
    persist();
  };
  function reserve(kind, label, model, upper) {
    must(!ledger.stop, "Journal stopped: " + ledger.stop);
    must(!ledger.entries.some((e) => e.label === label), "A previous dispatch has this label");
    if (usd(total(ledger.entries) + upper) > protocol.incrementalLimitUsd) {
      stop("budget");
      throw Error("Budget exhausted");
    }
    const entry = {
      kind,
      label,
      model,
      reservedUsd: upper,
      accountedUsd: upper,
      measured: false,
      startedAt: new Date().toISOString(),
      status: "reserved",
      http: null,
      host: null,
    };
    ledger.entries.push(entry);
    persist();
    return entry;
  }
  function settle(entry, cost, status) {
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
      entry.accountedUsd = usd(cost);
      entry.measured = true;
    }
    entry.status = status;
    entry.finishedAt = new Date().toISOString();
    if (entry.accountedUsd > entry.reservedUsd) stop("over-reservation");
    if (["authorization", "billing"].includes(status)) stop(status);
    persist();
  }
  // One capability authorizes one POST. SDK retries and redirects cannot escape this wrapper.
  const route = new AsyncLocalStorage(),
    originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input),
      url = new URL(raw),
      s = route.getStore();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    must(
      s && !s.used && s.origin === url.origin && (!s.path || s.path === url.pathname) && method === "POST",
      "Unreserved HTTP request",
    );
    s.used = true;
    s.entry.host = url.host;
    s.entry.path = url.pathname;
    persist();
    const response = await originalFetch(input, { ...init, redirect: "error" });
    s.entry.http = response.status;
    persist();
    return response;
  };
  return {
    ledger,
    persist,
    stop,
    reserve,
    settle,
    withWire: (entry, url, f, exact = false) => {
      const u = new URL(url);
      return route.run({ entry, origin: u.origin, path: exact ? u.pathname : null, used: false }, f);
    },
  };
}
export function httpStatus(http, message = "") {
  if (http === 402 || /billing|balance|insufficient.credit|insufficient.funds/i.test(message))
    return "billing";
  if (http === 401 || http === 403 || /invalid.api.key|unauthorized/i.test(message)) return "authorization";
  return http === 429 ? "rate-limit" : "provider";
}
function errorSummary(data) {
  const message = String(data?.error?.message ?? "");
  return message.replace(/AIza[\w-]{12,}|Bearer\s+\S+|sk-[\w-]{12,}/gi, "[redacted]").slice(0, 350);
}
/** A real Google response is saved before decoding. Re-decoding or resuming never dispatches a previously journalled request. */
export async function recordedDecision({
  request,
  label,
  journal,
  apiKey,
  signal,
  offline = false,
  quotaRecovery = false,
}) {
  const {
    createGeminiDecisionCaller,
    GEMINI_DECISION_ENDPOINT,
    GEMINI_DECISION_MODEL,
    readGeminiDecisionUsage,
  } = await import("../../../../scripts/openui-diagnostics/gemini-decision.ts");
  const requestSha256 = sha(request),
    suffix = quotaRecovery ? ".quota-recovery" : "";
  const cacheFile = "decision-cache/" + requestSha256 + suffix + ".json",
    path = join(here, cacheFile);
  const previous = existsSync(path) ? read(path) : null;
  let receipt = null,
    raw = previous,
    source = previous ? "reused" : "live",
    reported = null;
  const dispatchLabel = "decision/" + requestSha256 + suffix;
  const caller = createGeminiDecisionCaller({
    apiKey: apiKey || "offline-placeholder",
    onReceipt: (r) => {
      receipt = r;
    },
    fetch: async (url, opts) => {
      must(
        url === protocol.judge.endpoint &&
          url === GEMINI_DECISION_ENDPOINT &&
          GEMINI_DECISION_MODEL === protocol.judge.model,
        "Unexpected Google decision endpoint",
      );
      const body = JSON.parse(opts.body),
        wireSha256 = sha(opts.body);
      must(
        body.model === protocol.judge.model && Buffer.byteLength(opts.body) < 160000,
        "Unexpected decision payload",
      );
      if (quotaRecovery) {
        const first = read(join(here, "decision-cache", requestSha256 + ".json")),
          disposition = read(join(here, "quota-disposition.json"));
        must(
          disposition.eligible.includes(requestSha256) &&
            first.http === 429 &&
            first.payload?.error?.code === "too_many_requests" &&
            !first.payload.answers &&
            !first.payload.usage &&
            first.wireSha256 === wireSha256 &&
            first.requestSha256 === requestSha256,
          "Only an identical, explicitly rejected Google request may use a quota disposition",
        );
        if (!previous && !offline)
          must(
            Date.now() - Date.parse(first.finishedAt) >= disposition.minimumDelayAfterOriginalMs,
            "Google window has not elapsed",
          );
      }
      if (previous) {
        must(
          previous.requestSha256 === requestSha256 && previous.wireSha256 === wireSha256,
          "Cached state or wire differs",
        );
        if (!previous.http || !previous.payload) throw Error("Pending or unobserved dispatch");
        return Response.json(previous.payload, { status: previous.http });
      }
      if (offline || !apiKey || journal.ledger.entries.some((e) => e.label === dispatchLabel))
        throw Error("An unobservable or prohibited dispatch cannot repeat");
      const entry = journal.reserve(
        "decision",
        dispatchLabel,
        protocol.judge.model,
        protocol.judge.reserveUsd,
      );
      raw = {
        requestSha256,
        wireSha256,
        label,
        requestedModel: protocol.judge.model,
        endpoint: url,
        startedAt: entry.startedAt,
        http: null,
        payload: null,
        shape: null,
        ...(quotaRecovery ? { previousCacheFile: "decision-cache/" + requestSha256 + ".json" } : {}),
      };
      save(path, raw);
      try {
        const resp = await journal.withWire(entry, url, () => fetch(url, opts), true);
        const data = await resp
            .clone()
            .json()
            .catch(() => null),
          usage = readGeminiDecisionUsage(data);
        const status = resp.ok ? "complete" : httpStatus(resp.status, errorSummary(data));
        // Passing the complete successful Google envelope to the decoder is important: dropping
        // an unexpected field here could mask protocol drift. Only synthetic decisions reach here.
        const payload =
          resp.ok && data
            ? data
            : {
                error: {
                  code: data?.error?.code ?? null,
                  status: data?.error?.status ?? null,
                  message: errorSummary(data),
                },
                ...(data?.usage ? { usage: data.usage } : {}),
              };
        raw.http = resp.status;
        raw.payload = payload;
        raw.shape = data ? Object.keys(data) : null;
        raw.responseSha256 = data ? sha(data) : null;
        raw.finishedAt = new Date().toISOString();
        save(path, raw);
        journal.settle(
          entry,
          usage ? (usage.inputTokens * protocol.judge.inputPerMillionUsd) / 1e6 : null,
          status,
        );
        return Response.json(payload, { status: resp.status });
      } catch {
        journal.settle(entry, null, "uncertain");
        throw Error("Decision transport interrupted");
      }
    },
  });
  const outcome = await caller(request, signal);
  if (raw?.payload) reported = receipt?.reportedModel ?? null;
  return {
    caseId: label,
    requestSha256,
    cacheFile,
    source,
    reportedModel: reported,
    usage: receipt?.usage ?? outcome.response?.usage ?? null,
    receipt,
    outcome,
  };
}
