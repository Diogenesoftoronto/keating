import { TeacherPolicy, TopicDefinition, LessonPlan, LessonPhase } from "./types.js";
import { resolveTopic } from "./topics.js";

function prerequisiteBullets(topic: TopicDefinition): string[] {
  return topic.prerequisites.map((item) => `Recall ${item} and connect it to ${topic.title}.`);
}

function misconceptionBullets(topic: TopicDefinition): string[] {
  return topic.misconceptions.map((item) => `Address misconception: ${item}`);
}

function practiceBullets(topic: TopicDefinition, exerciseCount: number): string[] {
  const bullets = [...topic.exercises];
  while (bullets.length < exerciseCount) {
    bullets.push(`Invent a new example that makes ${topic.title} easier to explain.`);
  }
  return bullets.slice(0, exerciseCount).map((item) => `Practice: ${item}`);
}

export function buildLessonPlan(topicName: string, policy: TeacherPolicy): LessonPlan {
  const topic = resolveTopic(topicName);
  const phases: LessonPhase[] = [
    {
      id: "orient",
      title: "Orientation",
      purpose: "Assess prerequisites and frame the core question.",
      bullets: [
        `State the big question: ${topic.summary}`,
        ...prerequisiteBullets(topic)
      ]
    },
    {
      id: "intuition",
      title: "Intuition",
      purpose: "Teach the concept concretely before pushing notation or abstract framing.",
      bullets: topic.intuition.map((item) => `Intuition: ${item}`)
    },
    {
      id: "formal-core",
      title: "Formal Core",
      purpose: "Escalate into rigorous structure once intuition has traction.",
      bullets: topic.formalCore.map((item) => `Formal: ${item}`)
    },
    {
      id: "misconceptions",
      title: "Misconception Repair",
      purpose: "Anticipate predictable mistakes before they calcify.",
      bullets: misconceptionBullets(topic)
    },
    {
      id: "examples",
      title: "Worked Examples",
      purpose: "Move between examples so the learner sees the invariant structure.",
      bullets: topic.examples.map((item) => `Example: ${item}`)
    },
    {
      id: "practice",
      title: "Guided Practice",
      purpose: "Force retrieval and re-expression, not passive agreement.",
      bullets: practiceBullets(topic, policy.exerciseCount)
    },
    {
      id: "transfer",
      title: "Transfer and Reflection",
      purpose: "Bridge the concept across domains and make the learner summarize what changed.",
      bullets: [
        ...topic.reflections.map((item) => `Reflect: ${item}`),
        `Bridge ${topic.title} into: ${topic.interdisciplinaryHooks.join(", ")}.`
      ]
    }
  ];

  if (policy.diagramBias >= 0.55) {
    phases.splice(4, 0, {
      id: "diagram",
      title: "Diagram",
      purpose: "Compress the concept into a visual structure before free recall.",
      bullets: [
        `Map the concept using nodes: ${topic.diagramNodes.join(" -> ")}.`,
        `Ask the learner to narrate the diagram without reading from it.`
      ]
    });
  }

  if (policy.socraticRatio >= 0.6) {
    phases[0]!.bullets.unshift(`Open with a diagnostic question instead of a lecture on ${topic.title}.`);
    phases[5]!.bullets.unshift(`Pause after each practice step and ask the learner to predict the next move.`);
  }

  return { topic, policy, phases };
}

export function lessonPlanToMarkdown(plan: LessonPlan): string {
  const lines = [
    `# Lesson Plan: ${plan.topic.title}`,
    "",
    `- Domain: ${plan.topic.domain}`,
    `- Policy: ${plan.policy.name}`,
    `- Summary: ${plan.topic.summary}`,
    ""
  ];

  for (const phase of plan.phases) {
    lines.push(`## ${phase.title}`);
    lines.push(phase.purpose);
    lines.push("");
    for (const bullet of phase.bullets) {
      lines.push(`- ${bullet}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}
