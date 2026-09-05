import { createError, defineEventHandler, getHeader, readBody } from "h3";
import { createTavusConversation, TavusServerError } from "../../../utils/tavus";

export default defineEventHandler(async (event) => {
	try {
		const body = await readBody<{ conversationalContext?: unknown }>(event).catch(() => ({}));
		return await createTavusConversation({
			authorization: getHeader(event, "authorization"),
			dpop: getHeader(event, "x-notorganic-dpop"),
			conversationalContext: body?.conversationalContext,
		});
	} catch (error) {
		if (error instanceof TavusServerError) {
			throw createError({ statusCode: error.statusCode, statusMessage: error.message });
		}
		console.error("[tavus] Conversation creation failed:", error instanceof Error ? error.message : "Unknown error");
		throw createError({ statusCode: 502, statusMessage: "Tavus could not create the live conversation." });
	}
});
