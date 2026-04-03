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

  // Domain-specific phase customizations
  if (topic.domain === "code") {
    const exIdx = phases.findIndex((p) => p.id === "examples");
    if (exIdx !== -1) {
      phases.splice(exIdx + 1, 0, {
        id: "live-code",
        title: "Live Code",
        purpose: "Write and trace runnable code so the learner sees the concept execute.",
        bullets: [
          `Write a minimal runnable example demonstrating ${topic.title}.`,
          `Step through execution line by line, narrating state changes.`,
          `Ask the learner to predict output before running.`
        ]
      });
    }
  }

  if (topic.domain === "law") {
    const examples = phases.find((p) => p.id === "examples");
    if (examples) {
      examples.bullets.push(
        `Cite at least one leading case or statute relevant to ${topic.title}.`,
        `Distinguish the ratio decidendi from obiter dicta.`
      );
    }
  }

  if (topic.domain === "medicine") {
    const formalCore = phases.find((p) => p.id === "formal-core");
    if (formalCore) {
      formalCore.bullets.push(
        `Reference the level of evidence (RCT, meta-analysis, observational) for key claims about ${topic.title}.`,
        `Distinguish mechanism-based reasoning from evidence-based conclusions.`
      );
    }
  }

  if (topic.domain === "history") {
    const examples = phases.find((p) => p.id === "examples");
    if (examples) {
      examples.bullets.push(
        `Place ${topic.title} on a timeline with at least two contextual events.`,
        `Distinguish primary sources from secondary interpretation.`
      );
    }
  }

  if (topic.domain === "psychology") {
    const misconceptions = phases.find((p) => p.id === "misconceptions");
    if (misconceptions) {
      misconceptions.bullets.push(
        `Flag the replication status of key studies related to ${topic.title}.`,
        `Distinguish folk-psychology usage from empirical findings.`
      );
    }
  }

  if (topic.domain === "politics") {
    const transfer = phases.find((p) => p.id === "transfer");
    if (transfer) {
      transfer.bullets.push(
        `Present at least two competing analytical frameworks for ${topic.title}.`,
        `Distinguish normative claims from descriptive ones.`
      );
    }
  }

  if (topic.domain === "arts") {
    const examples = phases.find((p) => p.id === "examples");
    if (examples) {
      examples.bullets.push(
        `Ground analysis in at least one specific work that exemplifies ${topic.title}.`,
        `Connect formal technique to expressive effect.`
      );
    }
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
