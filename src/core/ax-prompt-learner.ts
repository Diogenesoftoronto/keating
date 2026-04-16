import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ai, ax, AxACE, AxOptimizedProgramImpl } from "@ax-llm/ax";
import { evaluatePromptContent } from "./prompt-evolution.js";
import { promptEvolutionDir, stateDir } from "./paths.js";
import { loadKeatingConfig } from "./config.js";

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
    apiKey: process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY || "",
    config: { model: mapToAxModel(config.pi.defaultModel || "google/gemini-2.5-pro") as any }
  });

  const teacherAI = ai({
    name: config.pi.defaultProvider === "openai" ? "openai" : "google-gemini",
    apiKey: process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY || "",
    config: { model: mapToAxModel("google/gemini-2.5-pro") as any }
  });

  const analyzer = ax('topic:string -> teachingResponse:string');
  analyzer.setDescription("You are Keating, a hyperteacher.");

  // Dummy baseline examples for ACE
  const examples = [
    { topic: "Functions", teachingResponse: "Functions are machines that take inputs and produce outputs." }
  ];

  const metric = async ({ prediction, example }: any) => {
    // Call the original heuristic / LLM evaluator
    const evalResult = await evaluatePromptContent(cwd, promptPath, prediction.teachingResponse);
    return evalResult.score / 100.0; 
  };

  try {
    const optimizer = new AxACE(
      { studentAI, teacherAI, verbose: true },
      { maxEpochs }
    );

    console.log(`Running ACE Prompt Learning for ${promptName}...`);
    const result = await optimizer.compile(analyzer, examples, metric);
    
    if (result.artifact?.playbook) {
      const playbookPath = join(stateDir(cwd), "ace-playbook.json");
      await writeFile(playbookPath, JSON.stringify(result.artifact.playbook, null, 2), "utf8");
      
      return { playbook: result.artifact.playbook };
    }
    return { playbook: {} };
  } catch (error) {
    console.warn("Ax ACE prompt optimization failed or API key missing, falling back to heuristics.", error);
    return { playbook: {} };
  }
}
