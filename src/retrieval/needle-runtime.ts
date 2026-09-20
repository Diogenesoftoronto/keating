/** Local-only Needle 3. The Python bridge is embedded so the compiled CLI is self-contained. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { configDir } from "../core/paths.js";

export const NEEDLE_VERSION = "3.0.1";
export interface NeedleRuntimeConfig {
  python: string;
  engine: string;
  weights: string;
  engineSha256: string;
  weightsSha256: string;
}
export interface NeedleRuntimeResult {
  model: string;
  vectors: number[][];
  selections: Array<{ sourceId: string; category: string; quote: string }>;
}
export interface NeedleRuntimeInput {
  texts: readonly string[];
  sources?: readonly { id: string; text: string }[];
}
export type NeedleCaller = (input: NeedleRuntimeInput) => Promise<NeedleRuntimeResult | null>;

// No learner text in argv, no shell, no prompt/output/error logging. Explicit paths
// bypass upstream auto-downloads, and the worker inherits both telemetry opt-outs.
export const NEEDLE_BRIDGE = String.raw`
import os, sys, json, hashlib
os.environ['NEEDLE_TELEMETRY'] = '0'
os.environ['DO_NOT_TRACK'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_OFFLINE'] = '1'
try:
    request = json.loads(sys.stdin.read(262145))
    config = request['config']
    for key in ('engine', 'weights'):
        with open(config[key], 'rb') as handle:
            digest = hashlib.file_digest(handle, 'sha256').hexdigest()
        if digest != config[key + 'Sha256']:
            raise ValueError('asset mismatch')
    os.environ['NEEDLE3_LIB_PATH'] = config['engine']
    import needle
    if needle.__version__ != '3.0.1':
        raise ValueError('runtime mismatch')
    texts = request['input']['texts']
    if len(texts) > 160 or any(not isinstance(text, str) or len(text) > 8192 for text in texts):
        raise ValueError('input bounds')
    agent = needle.Needle(generation=3, weights=config['weights'], auto_date=False)
    vectors = [agent.embed(text) for text in texts]
    agent.close()
    selections = []
    schema = {'name': 'learner_fact', 'description': 'A stated learner interest, motivation, communication preference, learning preference, or current study context. Copy the exact relevant words from the learner.', 'parameters': {'type': 'object', 'properties': {'category': {'type': 'string', 'enum': ['motivation','communication-preference','learning-preference','interest','study-context']}, 'quote': {'type': 'string', 'description': 'Copy a verbatim span from the learner text, never paraphrase.'}}, 'required': ['category','quote']}}
    for source in request['input'].get('sources', [])[:4]:
        if not isinstance(source.get('text'), str) or len(source['text']) > 2000:
            continue
        try:
            result = needle.extract(source['text'], schema, weights=config['weights'], max_new_tokens=128, strict=True, generation=3)
            quote = result.get('quote') if isinstance(result, dict) else None
            if isinstance(quote, str) and 3 <= len(quote) <= 500 and quote in source['text']:
                selections.append({'sourceId':source['id'],'category':result.get('category'),'quote':quote})
        except Exception:
            pass
    print(json.dumps({'model':'needle3/cactus-needle@3.0.1/sha256:'+config['weightsSha256']+'/engine:'+config['engineSha256'], 'vectors':vectors, 'selections':selections}, allow_nan=False))
except Exception:
    # Upstream errors can contain private inputs or local paths.
    print(json.dumps({'error':'needle_unavailable'}))
    sys.exit(1)
`;

export async function loadNeedleConfig(cwd: string): Promise<NeedleRuntimeConfig | null> {
  try {
    const path = join(configDir(cwd), "needle-runtime.json");
    if ((await stat(path)).size > 8192) return null;
    const value = JSON.parse(await readFile(path, "utf8")) as NeedleRuntimeConfig;
    if (![value.python, value.engine, value.weights].every(path => typeof path === "string" && isAbsolute(path))
      || ![value.engineSha256, value.weightsSha256].every(hash => /^[a-f0-9]{64}$/.test(hash))) return null;
    return value;
  } catch { return null; }
}

export function needleModelIdentity(config: NeedleRuntimeConfig): string {
  return `needle3/cactus-needle@${NEEDLE_VERSION}/sha256:${config.weightsSha256}/engine:${config.engineSha256}`;
}

export function needleTextHash(text: string): string { return createHash("sha256").update(text).digest("hex"); }

export function createNeedleCaller(config: NeedleRuntimeConfig, timeoutMs = 12_000): NeedleCaller {
  return async input => {
    if (input.texts.length > 160 || input.texts.some(text => typeof text !== "string" || text.length > 8192)) return null;
    const request = JSON.stringify({ config, input });
    if (Buffer.byteLength(request) > 262144) return null;
    const temporary = await mkdtemp(join(tmpdir(), "keating-needle-"));
    const inputFile = await open(join(temporary, "request.json"), "wx+", 0o600);
    try {
    await inputFile.write(request, 0, "utf8");
    return await new Promise<NeedleRuntimeResult | null>(resolve => {
      let settled = false;
      const finish = (result: NeedleRuntimeResult | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
      const child = spawn(config.python, ["-c", NEEDLE_BRIDGE], {
        // A regular-file descriptor avoids Bun's child_process piped-stdin EOF
        // behavior. The private request never appears in argv or process logs.
        stdio: [inputFile.fd, "pipe", "ignore"], windowsHide: true, detached: process.platform !== "win32",
        env: { ...process.env, NEEDLE_TELEMETRY: "0", DO_NOT_TRACK: "1", HF_HUB_DISABLE_TELEMETRY: "1", HF_HUB_OFFLINE: "1" },
      });
      const stop = () => {
        try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* already exited */ }
      };
      const timer = setTimeout(() => { stop(); finish(null); }, Math.max(100, Math.min(30_000, timeoutMs)));
      let output = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output.length > 12_000_000) { stop(); finish(null); }
      });
      child.on("error", () => finish(null));
      child.on("close", code => {
        stop();
        if (code !== 0) return finish(null);
        try {
          const result = JSON.parse(output) as NeedleRuntimeResult;
          const dimension = result.vectors?.[0]?.length;
          if (result.model !== needleModelIdentity(config) || !Array.isArray(result.vectors) || result.vectors.length !== input.texts.length
            || (result.vectors.length && (!dimension || dimension > 8192))
            || result.vectors.some(vector => !Array.isArray(vector) || vector.length !== dimension || vector.some(value => !Number.isFinite(value)))
            || !Array.isArray(result.selections)) return finish(null);
          finish(result);
        } catch { finish(null); }
      });
    });
    } catch { return null; }
    finally { await inputFile.close(); await rm(temporary, { recursive: true, force: true }); }
  };
}
