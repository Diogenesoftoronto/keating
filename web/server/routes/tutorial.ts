import { defineEventHandler, getRequestURL, sendRedirect } from "h3";
import { DOCUMENTATION_URL, legacyTutorialHref } from "../../src/lib/tutorial-links";

export default defineEventHandler((event) => {
	const url = getRequestURL(event);
	// Fragments never reach HTTP servers. SPA/desktop navigation can resolve them;
	// ordinary bookmarks still redirect to the guide selected by their old tab.
	return sendRedirect(event, legacyTutorialHref(`${url.pathname}${url.search}`) ?? DOCUMENTATION_URL, 308);
});
