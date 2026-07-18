import { containsLikelySecret } from "./redaction";
import { hasIndependentUserAuthorization, isUntrustedProvenance } from "./provenance";
import type {
	ToolPermissionDecision,
	ToolPermissionRequest,
	ToolRiskClass,
	ToolSecurityDescriptor,
} from "./types";

const ALWAYS_CONFIRM = new Set<ToolRiskClass>([
	"external-side-effect",
	"code-execution",
	"destructive",
]);

const NEVER_VOICE = new Set<ToolRiskClass>(["code-execution", "destructive"]);

export const KEATING_TOOL_RISKS: Readonly<Record<string, ToolRiskClass>> = {
	agent_runtime: "sensitive-read",
	bash: "code-execution",
	remote_execute: "code-execution",
	run_script: "code-execution",
	workspace_exec: "code-execution",
	workspace_change: "state-change",
	workspace_inspect: "sensitive-read",
	source_restore: "destructive",
	source_snapshot: "sensitive-read",
	source_diff: "sensitive-read",
	validate_source_edit: "code-execution",
	list_project_files: "sensitive-read",
	write_project_file: "state-change",
	edit_project_file: "state-change",
	source_edit: "state-change",
	remember_learner_profile: "state-change",
	set_learner_goal: "state-change",
	update_goal_step: "state-change",
	generate_image: "external-side-effect",
	animate: "external-side-effect",
	evolve: "state-change",
	auto_improve: "state-change",
	improve: "state-change",
	prompt_evolve: "state-change",
	request_teaching_improvement: "state-change",
	feedback: "state-change",
	grade_quiz: "state-change",
	grade_question_checks: "state-change",
	quiz: "informational",
	ask_user_question: "informational",
	learner_state: "sensitive-read",
	read_project_file: "sensitive-read",
	policy: "sensitive-read",
	outputs: "sensitive-read",
	trace: "sensitive-read",
	timeline: "sensitive-read",
	due: "sensitive-read",
	list_learner_goals: "sensitive-read",
	inspect_learning_context: "sensitive-read",
	bench: "informational",
	deck: "informational",
	prompt_eval: "informational",
	evaluate_teaching: "informational",
	keating_voice: "informational",
};

export function classifyTool(name: string): ToolSecurityDescriptor {
	const risk = KEATING_TOOL_RISKS[name];
	return risk ? { name, risk, known: true } : { name, risk: "code-execution", known: false, allowVoice: false };
}

export function evaluateToolPermission(request: ToolPermissionRequest): ToolPermissionDecision {
	const { tool, surface, provenance } = request;
	const reasons: string[] = [];
	const untrusted = isUntrustedProvenance(provenance);
	const independentlyAuthorized = hasIndependentUserAuthorization(provenance);
	const secretBearing = tool.sensitiveArguments === true || containsLikelySecret(request.arguments);

	if (tool.known === false && surface !== "text") {
		return decision("deny", tool.risk, ["Unknown tools are denied on voice and automation surfaces."], true);
	}
	if (tool.known === false) reasons.push("Unknown tools require explicit confirmation.");

	if (surface === "voice" && (tool.allowVoice === false || NEVER_VOICE.has(tool.risk))) {
		return decision("deny", tool.risk, ["This tool is not permitted from voice input."], true);
	}

	if (surface === "voice" && secretBearing) {
		return decision("deny", tool.risk, ["Secret-bearing arguments are not permitted from voice input."], true);
	}

	if (untrusted && !independentlyAuthorized) {
		if (tool.risk === "code-execution" || tool.risk === "destructive") {
			return decision("deny", tool.risk, ["Untrusted web content cannot authorize code execution or destructive actions."], true);
		}
		if (tool.risk !== "informational") {
			reasons.push("Untrusted web content cannot independently authorize this action.");
		}
	}

	if (ALWAYS_CONFIRM.has(tool.risk)) reasons.push(`Risk class ${tool.risk} requires confirmation.`);
	if (tool.risk === "state-change" && (surface !== "text" || untrusted)) {
		reasons.push("State changes require confirmation on this surface or provenance.");
	}
	if (tool.risk === "sensitive-read" && (untrusted || surface === "voice")) {
		reasons.push("Sensitive reads require confirmation on this surface or provenance.");
	}
	if (secretBearing && tool.risk !== "informational") {
		reasons.push("The invocation contains sensitive arguments.");
	}

	return reasons.length > 0
		? decision("confirm", tool.risk, reasons, true)
		: decision("allow", tool.risk, [], false);
}

function decision(
	outcome: ToolPermissionDecision["outcome"],
	risk: ToolRiskClass,
	reasons: readonly string[],
	requiresTrustedUserConfirmation: boolean,
): ToolPermissionDecision {
	return { outcome, risk, reasons, requiresTrustedUserConfirmation };
}
