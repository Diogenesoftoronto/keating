/** Immutable FP32 decision weights; installation is independent of calibration. */
import { JULIA_ENCODER_VERSION } from "./encoder.js";
export const JULIA_REPOSITORY = "SupersonicLabs/Julia-1-ONNX";
export const JULIA_REVISION = "82a2fadf8fccfccdc5fd4e1009ba8f1a265eb7a8";
export const JULIA_ARTIFACT_ID = `${JULIA_REPOSITORY}@${JULIA_REVISION}/keating-scorer-v1`;
export function juliaModelId(runtime: "native" | "browser" | "mobile", maxLength: number, headLength: number, threads = runtime === "browser" ? 1 : 4): string {
  const provider = { native: "ort-1.29.0-cpu", browser: "ort-1.29.0-wasm", mobile: "ort-rn-1.24.3-cpu" }[runtime];
  return `${JULIA_ARTIFACT_ID}/${provider}/${JULIA_ENCODER_VERSION}/context${maxLength}-head${headLength}/threads${threads}`;
}
export const JULIA_MODEL_ID = juliaModelId("native", 2048, 512);
export const JULIA_BROWSER_MODEL_ID = juliaModelId("browser", 2048, 512);
export const JULIA_MOBILE_MODEL_ID = juliaModelId("mobile", 1024, 256);
const base = `https://huggingface.co/${JULIA_REPOSITORY}/resolve/${JULIA_REVISION}`;
export const JULIA_ARTIFACTS = [
  { file: "model.onnx", bytes: 2988923, sha256: "97141d0cfb1da6204e9f8f24d581af72eaeb82cda21149d83eaa6df7160fbcd9" },
  { file: "model.onnx.data", bytes: 576782336, sha256: "fd915be810d7ebfb80fb05a48dd33c9484d17ae1b6bcb9e1f544cbaaa913ded1" },
  { file: "tokenizer.json", bytes: 34363188, sha256: "609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f" },
  { file: "tokenizer_config.json", bytes: 652, sha256: "6b069e57db0ce0794c22547725275f22618809c4ef4249307337e651a0dfef8c" },
].map(artifact => Object.freeze({ ...artifact, url: `${base}/${artifact.file}` }));
export const JULIA_TOTAL_BYTES = JULIA_ARTIFACTS.reduce((sum, artifact) => sum + artifact.bytes, 0);
export const JULIA_MODEL = Object.freeze({ id: JULIA_MODEL_ID, revision: JULIA_REVISION, scorerVersion: "keating-scorer-v1", encoderVersion: JULIA_ENCODER_VERSION, contextTokens: 2048, headTokens: 512, files: JULIA_ARTIFACTS });
