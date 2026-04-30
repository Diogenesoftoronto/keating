/**
 * Projects & Assignments Engine — long-horizon learning with milestones.
 *
 * Learners get multi-stage projects that span days or weeks, with:
 * - Milestones (verified checkpoints)
 * - Deliverables (artifacts to produce)
 * - Rubrics (grading criteria)
 * - Progress tracking
 */

import { resolveTopic } from "./topics.js";

export type MilestoneStatus = "not_started" | "in_progress" | "submitted" | "reviewed";

export interface Deliverable {
  id: string;
  title: string;
  description: string;
  format: "essay" | "code" | "diagram" | "presentation" | "implementation" | "analysis";
  minWords?: number;
  rubric: string[];
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  deliverables: Deliverable[];
  estimatedHours: number;
  prerequisites: string[];
  status: MilestoneStatus;
  completedAt?: string;
}

export interface Project {
  id: string;
  title: string;
  topic: string;
  slug: string;
  description: string;
  learningObjectives: string[];
  milestones: Milestone[];
  totalEstimatedHours: number;
  generatedAt: string;
}

export interface Assignment {
  id: string;
  slug: string;
  title: string;
  topic: string;
  instructions: string;
  deliverables: Deliverable[];
  dueInDays: number;
  rubric: string[];
  generatedAt: string;
}

// ─── Project Generation ───────────────────────────────────────────────────

export function generateProject(topicName: string): Project {
  const topic = resolveTopic(topicName);
  const id = `proj-${topic.slug}-${Date.now().toString(36)}`;

  const milestones: Milestone[] = [
    {
      id: `${id}-m1`,
      title: "Research & Foundation",
      description: `Investigate the core definitions, history, and key figures behind ${topic.title}.`,
      deliverables: [
        {
          id: `${id}-d1`,
          title: "Concept Map",
          description: `Create a concept map showing ${topic.title}, its prerequisites, and key relationships.`,
          format: "diagram",
          rubric: [
            "Includes core concept node",
            "Links to at least 3 prerequisites",
            "Shows relationship arrows with labels",
            "Identifies at least 1 common misconception"
          ]
        },
        {
          id: `${id}-d2`,
          title: "Annotated Summary",
          description: `Write a 200-word summary of ${topic.title} annotated with your own questions and connections.`,
          format: "essay",
          minWords: 200,
          rubric: [
            "Accurately captures core definition",
            "Includes at least 2 personal questions",
            "Connects to prior knowledge",
            "Identifies what is still unclear"
          ]
        }
      ],
      estimatedHours: 2,
      prerequisites: topic.prerequisites,
      status: "not_started"
    },
    {
      id: `${id}-m2`,
      title: "Deep Dive",
      description: `Work through examples and exercises demonstrating ${topic.title} in practice.`,
      deliverables: [
        {
          id: `${id}-d3`,
          title: "Worked Examples",
          description: `Solve ${topic.examples.length} worked examples, showing all reasoning.`,
          format: "implementation",
          rubric: [
            "All steps shown with justification",
            "At least one alternative approach explored",
            "Common mistakes identified and avoided",
            "Final answer verifiable"
          ]
        },
        {
          id: `${id}-d4`,
          title: "Practice Problems",
          description: `Create 3 original practice problems on ${topic.title} with solutions.`,
          format: "implementation",
          rubric: [
            "Problems cover different difficulty levels",
            "Solutions are correct and complete",
            "At least one problem targets a known misconception",
            "Clear marking scheme provided"
          ]
        }
      ],
      estimatedHours: 4,
      prerequisites: [],
      status: "not_started"
    },
    {
      id: `${id}-m3`,
      title: "Transfer & Synthesis",
      description: `Apply ${topic.title} to a new domain or build a creative extension.`,
      deliverables: [
        {
          id: `${id}-d5`,
          title: "Transfer Report",
          description: `Choose a domain from ${topic.interdisciplinaryHooks.join(", ")} and build an explicit bridge.`,
          format: "analysis",
          minWords: 300,
          rubric: [
            "Chooses a specific external domain",
            "Identifies structural similarities",
            "Acknowledges where the analogy breaks",
            "Proposes a novel insight or question"
          ]
        }
      ],
      estimatedHours: 3,
      prerequisites: [],
      status: "not_started"
    },
    {
      id: `${id}-m4`,
      title: "Teach-Back",
      description: `Teach ${topic.title} to another learner. Teaching is the ultimate test of understanding.`,
      deliverables: [
        {
          id: `${id}-d6`,
          title: "Teaching Artifact",
          description: `Create a teaching artifact: slides, blog post, video script, or interactive demo.`,
          format: "presentation",
          rubric: [
            "Intuition comes before formalism",
            "At least 2 examples (one simple, one complex)",
            "Common misconception addressed explicitly",
            "Includes a reflection question for the student"
          ]
        }
      ],
      estimatedHours: 4,
      prerequisites: [],
      status: "not_started"
    }
  ];

  return {
    id,
    title: `${topic.title} Mastery Project`,
    topic: topic.title,
    slug: topic.slug,
    description: `A comprehensive project to master ${topic.title} through research, practice, transfer, and teaching.`,
    learningObjectives: [
      `Define ${topic.title} precisely`,
      `Apply ${topic.title} to solve unfamiliar problems`,
      `Transfer ${topic.title} to at least one new domain`,
      `Teach ${topic.title} to someone with no prior exposure`
    ],
    milestones,
    totalEstimatedHours: milestones.reduce((s, m) => s + m.estimatedHours, 0),
    generatedAt: new Date().toISOString()
  };
}

// ─── Assignment Generation ────────────────────────────────────────────────

export function generateAssignment(topicName: string): Assignment {
  const topic = resolveTopic(topicName);
  const id = `asgn-${topic.slug}-${Date.now().toString(36)}`;

  return {
    id,
    slug: topic.slug,
    title: `${topic.title} Challenge`,
    topic: topic.title,
    instructions: `Complete all deliverables below. Focus on understanding, not speed. If you are stuck for more than 20 minutes, ask for help rather than guessing.`,
    deliverables: [
      {
        id: `${id}-d1`,
        title: "Core Analysis",
        description: `Analyze ${topic.title} using formal definitions. Show your reasoning chain.`,
        format: "essay",
        minWords: 250,
        rubric: [
          "Uses correct formal definitions",
          "Logic is sequential and verifiable",
          "Assumptions are stated explicitly",
          "Conclusion is supported by evidence"
        ]
      },
      {
        id: `${id}-d2`,
        title: "Creative Extension",
        description: `Propose a question, extension, or application of ${topic.title} that is NOT covered in standard textbooks.`,
        format: "analysis",
        rubric: [
          "Question is genuinely novel",
          "Builds on core concepts",
          "Is answerable with reasonable effort",
          "Author demonstrates awareness of what they do not yet know"
        ]
      }
    ],
    dueInDays: 7,
    rubric: [
      "All deliverables present and complete",
      "Demonstrates original thinking, not paraphrasing",
      "Acknowledges uncertainty where appropriate",
      "Written in learner's own voice"
    ],
    generatedAt: new Date().toISOString()
  };
}

// ─── Markdown output ──────────────────────────────────────────────────────

export function projectToMarkdown(project: Project): string {
  const lines = [
    `# Project: ${project.title}`,
    "",
    project.description,
    "",
    `**Estimated time:** ${project.totalEstimatedHours} hours`,
    `**ID:** ${project.id}`,
    "",
    "## Learning Objectives",
    "",
    ...project.learningObjectives.map(o => `- ${o}`),
    ""
  ];

  for (const m of project.milestones) {
    lines.push(`---`);
    lines.push(`# Milestone: ${m.title}`);
    lines.push(m.description);
    lines.push(`**Status:** ${m.status} | **Estimated:** ${m.estimatedHours}h`);
    if (m.prerequisites.length > 0) {
      lines.push(`**Prerequisites:** ${m.prerequisites.join(", ")}`);
    }
    lines.push("");
    for (const d of m.deliverables) {
      lines.push(`### ${d.title}`);
      lines.push(d.description);
      if (d.minWords) lines.push(`*Minimum length:* ${d.minWords} words`);
      lines.push("**Rubric:**");
      for (const r of d.rubric) lines.push(`- [ ] ${r}`);
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}

export function assignmentToMarkdown(assignment: Assignment): string {
  const lines = [
    `# Assignment: ${assignment.title}`,
    "",
    assignment.instructions,
    `**Due in:** ${assignment.dueInDays} days`,
    "",
    "## Deliverables",
    ""
  ];

  for (const d of assignment.deliverables) {
    lines.push(`### ${d.title}`);
    lines.push(d.description);
    if (d.minWords) lines.push(`*Minimum:* ${d.minWords} words`);
    lines.push("**Rubric:**");
    for (const r of d.rubric) lines.push(`- [ ] ${r}`);
    lines.push("");
  }

  lines.push("## Overall Rubric");
  for (const r of assignment.rubric) lines.push(`- [ ] ${r}`);
  lines.push("");

  return lines.join("\n") + "\n";
}

// ─── Progress Tracking ────────────────────────────────────────────────────

export interface ProjectProgress {
  projectId: string;
  milestonesCompleted: number;
  milestonesTotal: number;
  deliverablesCompleted: number;
  deliverablesTotal: number;
  hoursLogged: number;
  overallStatus: "not_started" | "in_progress" | "completed";
  lastActivityAt: string;
}

export function computeProjectProgress(project: Project): ProjectProgress {
  const totalMilestones = project.milestones.length;
  const completedMilestones = project.milestones.filter(m => m.status === "reviewed").length;
  const totalDeliverables = project.milestones.reduce((s, m) => s + m.deliverables.length, 0);
  const completedDeliverables = project.milestones
    .filter(m => m.status === "reviewed")
    .reduce((s, m) => s + m.deliverables.length, 0);
  const hours = project.milestones.reduce((s, m) => s + (m.status !== "not_started" ? m.estimatedHours : 0), 0);

  let overall: ProjectProgress["overallStatus"] = "not_started";
  if (completedMilestones === totalMilestones) overall = "completed";
  else if (completedMilestones > 0 || project.milestones.some(m => m.status === "in_progress")) overall = "in_progress";

  return {
    projectId: project.id,
    milestonesCompleted: completedMilestones,
    milestonesTotal: totalMilestones,
    deliverablesCompleted: completedDeliverables,
    deliverablesTotal: totalDeliverables,
    hoursLogged: hours,
    overallStatus: overall,
    lastActivityAt: new Date().toISOString()
  };
}
