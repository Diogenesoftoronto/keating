import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ai, ax, optimize, axSerializeOptimizedProgram } from "@ax-llm/ax";
import { evaluatePromptContent } from "./prompt-evolution.js";
import { stateDir } from "./paths.js";
import { DEFAULT_PI_MODEL, loadKeatingConfig } from "./config.js";

// Helper to convert typical string models to Ax model enums or strings
function mapToAxModel(keatingModel: string): string {
  if (keatingModel.includes("gpt-4o-mini")) return "gpt-4o-mini";
  if (keatingModel.includes("gpt-4o")) return "gpt-4o";
  if (keatingModel.includes("claude-3-5-sonnet")) return "claude-3-5-sonnet-20240620";
  // fallback
  return keatingModel;
}

export interface LearnPromptOptions {
  maxEpochs?: number;
  onlineUpdates?: boolean;
}

const GEPA_PLAYBOOK_FILE = "gepa-prompt-playbook.json";

export async function learnPrompt(
  cwd: string,
  promptName: string = "learn",
  options: LearnPromptOptions = {}
): Promise<{ playbook: any }> {
  const { maxEpochs = 3 } = options;
  const promptPath = join(cwd, "pi", "prompts", `${promptName}.md`);
  const basePrompt = await readFile(promptPath, "utf8");

  const config = await loadKeatingConfig(cwd);

  const studentAI = ai({
    name: config.pi.defaultProvider === "openai" ? "openai" : "google-gemini",
    apiKey: process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    config: { model: mapToAxModel(config.pi.defaultModel || DEFAULT_PI_MODEL) as any }
  });

  const teacherAI = ai({
    name: config.pi.defaultProvider === "openai" ? "openai" : "google-gemini",
    apiKey: process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    config: { model: mapToAxModel(DEFAULT_PI_MODEL) as any }
  });

  const analyzer = ax("topic:string -> teachingResponse:string");
  analyzer.setDescription(
    [
      "You are Keating, a hyperteacher.",
      "Use the prompt template below as the teaching style being optimized.",
      basePrompt.trim()
    ].join("\n\n")
  );

  // Small seed set for GEPA; the optimizer mutates prompt components, not source files.
  const examples = [
    { topic: "Functions", teachingResponse: "Functions are machines that take inputs and produce outputs." },
    { topic: "Fractions", teachingResponse: "Fractions compare a part to a whole or to another quantity." },
    { topic: "Photosynthesis", teachingResponse: "Photosynthesis turns light, water, and carbon dioxide into stored chemical energy." },
    { topic: "Constitutional precedent", teachingResponse: "A precedent is a past ruling that shapes how later courts reason about similar questions." },
    { topic: "Pointers", teachingResponse: "A pointer stores an address so code can refer to data indirectly." },
    { topic: "Supply and demand", teachingResponse: "Supply and demand describe how scarcity and willingness to pay push prices toward balance." },
    { topic: "Working memory", teachingResponse: "Working memory is the short-term mental workspace used to hold and manipulate information." },
    { topic: "Primary sources", teachingResponse: "A primary source is evidence created close to the event or experience being studied." },
    { topic: "Metaphor", teachingResponse: "A metaphor maps one idea onto another so a reader can understand it through a fresh relation." },
    { topic: "Bayes theorem", teachingResponse: "Bayes theorem updates a belief by combining prior odds with how strongly new evidence points." }
  ];
  const validationExamples = [
    { topic: "Derivatives", teachingResponse: "A derivative measures how quickly something changes at a point." },
    { topic: "Cell membranes", teachingResponse: "A cell membrane controls what enters and leaves while helping the cell keep its internal conditions stable." }
  ];

  const metric = async ({ prediction }: any) => {
    const teachingResponse = typeof prediction?.teachingResponse === "string" ? prediction.teachingResponse : "";
    if (teachingResponse.trim().length === 0) return 0;

    const evalResult = await evaluatePromptContent(cwd, promptPath, teachingResponse);
    return Math.max(0, Math.min(1, evalResult.score / 100));
  };

  try {
    const numTrials = Math.max(1, Math.floor(maxEpochs));

    console.log(`Running GEPA Prompt Learning for ${promptName}...`);
    const result = await optimize(analyzer, examples, metric, {
      studentAI,
      teacherAI,
      numTrials,
      validationExamples,
      maxMetricCalls: Math.max(12, (numTrials + 2) * (examples.length + validationExamples.length)),
      minibatch: true,
      minibatchSize: Math.min(2, examples.length),
      sampleCount: 1,
      earlyStoppingTrials: Math.max(1, Math.ceil(numTrials / 2)),
      bootstrap: false,
      verbose: true
    });
    
    if (result.optimizedProgram) {
      const playbook = axSerializeOptimizedProgram(result.optimizedProgram);
      const playbookPath = join(stateDir(cwd), GEPA_PLAYBOOK_FILE);
      await mkdir(stateDir(cwd), { recursive: true });
      await writeFile(playbookPath, JSON.stringify(playbook, null, 2), "utf8");
      
      return { playbook };
    }
    return { playbook: {} };
  } catch (error) {
    console.warn("Ax GEPA prompt optimization failed or API key missing, falling back to heuristics.", error);
    return { playbook: {} };
  }
}
