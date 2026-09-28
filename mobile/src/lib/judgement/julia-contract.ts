import { JULIA_MOBILE_MODEL_ID } from "../../../../shared/julia/manifest";

export const MOBILE_JULIA_MODEL = JULIA_MOBILE_MODEL_ID;
export const MOBILE_JULIA_SESSION_OPTIONS = Object.freeze({ executionProviders: ["cpu"], intraOpNumThreads: 4, interOpNumThreads: 1,
  executionMode: "sequential" as const, graphOptimizationLevel: "all" as const, enableCpuMemArena: false });
