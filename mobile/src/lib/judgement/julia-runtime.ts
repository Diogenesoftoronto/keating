import type { InferenceSession } from "onnxruntime-react-native";
import { AppState } from "react-native";
import { createJuliaEncoder, type JuliaDecisionRequest, type JuliaEncoder } from "../../../../shared/julia/encoder";
import { createJuliaLabelScorer, juliaWeights } from "../../../../shared/julia/scorer";
import { juliaTensorData } from "../../../../shared/julia/tensors";
import { MOBILE_JULIA_SESSION_OPTIONS } from "./julia-contract";
import { verifiedJuliaFiles } from "./julia-model";

let session: InferenceSession | undefined, encoder: JuliaEncoder | undefined;
let busy = false;
export async function unloadMobileJulia() {
  if (busy) throw new Error("Wait for Julia review to finish.");
  const old = session; session = undefined; encoder = undefined;
  await old?.release();
}
async function weights(rows: readonly JuliaDecisionRequest[], signal?: AbortSignal): Promise<number[][]> {
  if (rows.length !== 1 || signal?.aborted) throw new Error("Julia review cancelled or invalid batch.");
  const { withOfflineJudgement } = await import("../offline-model");
  return withOfflineJudgement(async () => {
    busy = true;
    try {
      const ort = await import("onnxruntime-react-native");
      const nativeVersion = (globalThis as typeof globalThis & { OrtApi?: { version?: string } }).OrtApi?.version;
      if ((ort.env.versions as Record<string, string>)["react-native"] !== "1.24.3" || nativeVersion !== "1.24.3") throw new Error("Julia requires the pinned ONNX Android runtime 1.24.3. Install the updated Keating native app.");
      if (!session || !encoder) {
        const files = await verifiedJuliaFiles();
        encoder = createJuliaEncoder(files.tokenizer, files.tokenizerConfig);
        session = await ort.InferenceSession.create(files.model, { ...MOBILE_JULIA_SESSION_OPTIONS });
      }
      if (signal?.aborted) throw new Error("Julia review cancelled.");
      const input = encoder.encode(rows[0]!, { maxLength: 1024, headLength: 256 });
      const { length, count, ids, attention, markers, mask, qtype } = juliaTensorData([input]);
      const output = await session.run({ input_ids: new ort.Tensor("int64", ids, [1, length]), attention_mask: new ort.Tensor("int64", attention, [1, length]),
        marker_pos: new ort.Tensor("int64", markers, [1, count]), marker_mask: new ort.Tensor("bool", mask, [1, count]),
        qtype: new ort.Tensor("int64", qtype, [1]) }, ["logits"]);
      try {
        if (signal?.aborted || AppState.currentState !== "active") throw new Error("Julia review cancelled.");
        const values = output.logits?.data;
        if (!(values instanceof Float32Array) || values.length !== count) throw new Error("Invalid Julia output.");
        return [juliaWeights(values)];
      } finally { for (const value of Object.values(output)) value.dispose(); }
    } finally {
      busy = false;
      if (AppState.currentState !== "active") await unloadMobileJulia();
    }
  });
}
export const createMobileJuliaScorer = () => createJuliaLabelScorer({ weights });
AppState.addEventListener("change", state => { if (state !== "active" && !busy) void unloadMobileJulia().catch(() => undefined); });
