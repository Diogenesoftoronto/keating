import { createError, defineEventHandler, getHeader, getRouterParam } from "h3";
import { endTavusConversation, TavusServerError } from "../../../../utils/tavus";

export default defineEventHandler(async (event) => {
	const conversationId = getRouterParam(event, "conversationId") ?? "";
	try {
		await endTavusConversation(conversationId, {
			authorization: getHeader(event, "authorization"),
			dpop: getHeader(event, "x-notorganic-dpop"),
			terminationToken: getHeader(event, "x-tavus-termination-token") ?? "",
		});
		return { ended: true };
	} catch (error) {
		if (error instanceof TavusServerError) {
			throw createError({ statusCode: error.statusCode, statusMessage: error.message });
		}
		console.error("[tavus] Conversation cleanup failed:", error instanceof Error ? error.message : "Unknown error");
		throw createError({ statusCode: 502, statusMessage: "Tavus could not end the live conversation." });
	}
});
