import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
} from "@earendil-works/pi-ai";

function toolAliases(name: string): string[] {
	const trimmed = name.trim();
	const withoutNamespace = trimmed.split(/[.:/]/).at(-1) ?? trimmed;
	const withoutFunctionPrefix = trimmed.replace(/^(?:functions?|tools?)_/, "");

	return Array.from(new Set([
		trimmed,
		withoutNamespace,
		withoutFunctionPrefix,
		withoutNamespace.replace(/-/g, "_"),
		withoutNamespace.replace(/_/g, "-"),
	]));
}

export function resolveToolCallName(name: string, context: Context): string {
	const tools = context.tools ?? [];
	if (tools.some((tool) => tool.name === name)) return name;

	const lowerAliases = toolAliases(name).map((alias) => alias.toLowerCase());
	const match = tools.find((tool) => lowerAliases.includes(tool.name.toLowerCase()));
	return match?.name ?? name;
}

function normalizeToolCalls(message: AssistantMessage, context: Context): AssistantMessage {
	for (const part of message.content) {
		if (part.type === "toolCall") {
			part.name = resolveToolCallName(part.name, context);
		}
	}
	return message;
}

function normalizeEvent(event: AssistantMessageEvent, context: Context): AssistantMessageEvent {
	if ("partial" in event) normalizeToolCalls(event.partial, context);
	if (event.type === "toolcall_end") {
		event.toolCall.name = resolveToolCallName(event.toolCall.name, context);
	}
	if (event.type === "done") normalizeToolCalls(event.message, context);
	if (event.type === "error") normalizeToolCalls(event.error, context);
	return event;
}

export function normalizeToolCallStream(
	source: AssistantMessageEventStream,
	context: Context,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	void (async () => {
		for await (const event of source) {
			stream.push(normalizeEvent(event, context));
		}
		stream.end(normalizeToolCalls(await source.result(), context));
	})();

	return stream;
}
