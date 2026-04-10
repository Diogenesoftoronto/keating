globalThis.__nitro_main__ = import.meta.url;
import { a as defineLazyEventHandler, c as serve, i as defineHandler, n as HTTPError, o as toEventHandler, s as NodeResponse, t as H3Core } from "./_libs/h3+rou3+srvx.mjs";
import "./_libs/hookable.mjs";
import { i as withoutTrailingSlash, n as joinURL, r as withLeadingSlash, t as decodePath } from "./_libs/ufo.mjs";
import { promises } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
//#region #nitro-vite-setup
globalThis.__nitro_vite_envs__ = {};
//#endregion
//#region node_modules/nitro/dist/runtime/internal/error/prod.mjs
var errorHandler = (error, event) => {
	const res = defaultHandler(error, event);
	return new NodeResponse(typeof res.body === "string" ? res.body : JSON.stringify(res.body, null, 2), res);
};
function defaultHandler(error, event) {
	const unhandled = error.unhandled ?? !HTTPError.isError(error);
	const { status = 500, statusText = "" } = unhandled ? {} : error;
	if (status === 404) {
		const url = event.url || new URL(event.req.url);
		const baseURL = "/";
		if (/^\/[^/]/.test(baseURL) && !url.pathname.startsWith(baseURL)) return {
			status: 302,
			headers: new Headers({ location: `${baseURL}${url.pathname.slice(1)}${url.search}` })
		};
	}
	const headers = new Headers(unhandled ? {} : error.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	return {
		status,
		statusText,
		headers,
		body: {
			error: true,
			...unhandled ? {
				status,
				unhandled: true
			} : typeof error.toJSON === "function" ? error.toJSON() : {
				status,
				statusText,
				message: error.message
			}
		}
	};
}
//#endregion
//#region #nitro/virtual/error-handler
var errorHandlers = [errorHandler];
async function error_handler_default(error, event) {
	for (const handler of errorHandlers) try {
		const response = await handler(error, event, { defaultHandler });
		if (response) return response;
	} catch (error) {
		console.error(error);
	}
}
//#endregion
//#region node_modules/nitro/dist/runtime/internal/route-rules.mjs
var headers = ((m) => function headersRouteRule(event) {
	for (const [key, value] of Object.entries(m.options || {})) event.res.headers.set(key, value);
});
//#endregion
//#region #nitro/virtual/public-assets-data
var public_assets_data_default = {
	"/apple-touch-icon.svg": {
		"type": "image/svg+xml",
		"etag": "\"1dc-ERPhA59WPG9PMagrYJyjsSPZSZA\"",
		"mtime": "2026-04-10T14:02:38.458Z",
		"size": 476,
		"path": "../public/apple-touch-icon.svg"
	},
	"/favicon.svg": {
		"type": "image/svg+xml",
		"etag": "\"1d3-vyCqW50L04maiE9pHTf/6Zl/pwc\"",
		"mtime": "2026-04-10T14:02:38.458Z",
		"size": 467,
		"path": "../public/favicon.svg"
	},
	"/manifest.webmanifest": {
		"type": "application/manifest+json",
		"etag": "\"1f6-u0s1NgHJ89kWW2Gl9++DGvfLpfk\"",
		"mtime": "2026-04-10T14:02:37.050Z",
		"size": 502,
		"path": "../public/manifest.webmanifest"
	},
	"/index.html": {
		"type": "text/html; charset=utf-8",
		"etag": "\"85f-4TeHzDMeA9tFvFYnIg0ilPOqr2U\"",
		"mtime": "2026-04-10T14:02:38.459Z",
		"size": 2143,
		"path": "../public/index.html"
	},
	"/pwa-512x512.svg": {
		"type": "image/svg+xml",
		"etag": "\"1de-5WPQ8aJg53aQBSL8iGuenOcTMfg\"",
		"mtime": "2026-04-10T14:02:38.458Z",
		"size": 478,
		"path": "../public/pwa-512x512.svg"
	},
	"/pwa-192x192.svg": {
		"type": "image/svg+xml",
		"etag": "\"1dc-ooucffMgzUhBK7rmKw4PJatSO3Q\"",
		"mtime": "2026-04-10T14:02:38.458Z",
		"size": 476,
		"path": "../public/pwa-192x192.svg"
	},
	"/registerSW.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"86-uD38uo0sV8qINzJL85XzR0gDOlA\"",
		"mtime": "2026-04-10T14:02:37.050Z",
		"size": 134,
		"path": "../public/registerSW.js"
	},
	"/sw.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"7f1-fvC8Uyb01ZsOC+oloGv2lIdCOR4\"",
		"mtime": "2026-04-10T14:02:38.459Z",
		"size": 2033,
		"path": "../public/sw.js"
	},
	"/assets/azure-openai-responses-imRbpMVO.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"cca-F2vosXMp6vqYGMNh/mO/U0SacNw\"",
		"mtime": "2026-04-10T14:02:37.038Z",
		"size": 3274,
		"path": "../public/assets/azure-openai-responses-imRbpMVO.js"
	},
	"/assets/env-api-keys-oAkrTNpw.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"af2-YnvCiRnDblsDTjgvWd0gTp3RDrA\"",
		"mtime": "2026-04-10T14:02:37.038Z",
		"size": 2802,
		"path": "../public/assets/env-api-keys-oAkrTNpw.js"
	},
	"/assets/anthropic-CNCELX5P.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"14147-uey5D8OiDVhCCV3fy5UPVPw6e+s\"",
		"mtime": "2026-04-10T14:02:37.037Z",
		"size": 82247,
		"path": "../public/assets/anthropic-CNCELX5P.js"
	},
	"/assets/github-copilot-headers-DO2oe4-L.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"195-eSLn8DOae6cc1ZXmmdKLKlPMtZY\"",
		"mtime": "2026-04-10T14:02:37.038Z",
		"size": 405,
		"path": "../public/assets/github-copilot-headers-DO2oe4-L.js"
	},
	"/assets/google-VyR83Q53.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"15ef-h1xYD1wyXWxmJr/LdcQYJc4tQC0\"",
		"mtime": "2026-04-10T14:02:37.038Z",
		"size": 5615,
		"path": "../public/assets/google-VyR83Q53.js"
	},
	"/assets/google-gemini-cli-CJUcvw4K.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"2b73-Mo1LZKCpA2Zmkp0jwkiHMcZIBPQ\"",
		"mtime": "2026-04-10T14:02:37.038Z",
		"size": 11123,
		"path": "../public/assets/google-gemini-cli-CJUcvw4K.js"
	},
	"/assets/event-stream-BIgHRjJQ.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"3da85-v+Gb/3w3c7i49LeRrAAwpMxv7Cs\"",
		"mtime": "2026-04-10T14:02:37.038Z",
		"size": 252549,
		"path": "../public/assets/event-stream-BIgHRjJQ.js"
	},
	"/assets/google-vertex-CtEO5q36.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"18b8-of7gZfxJKAQGktXzb1aO3WZBl7w\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 6328,
		"path": "../public/assets/google-vertex-CtEO5q36.js"
	},
	"/assets/hash-776nUXJO.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"156-hvAekKPf4hZG/C7uJoGe6PJ0/0Q\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 342,
		"path": "../public/assets/hash-776nUXJO.js"
	},
	"/assets/google-shared-tRQnG-Em.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"40374-WF+GwgDJFi6wJteXZ4PxsrUKN+M\"",
		"mtime": "2026-04-10T14:02:37.038Z",
		"size": 263028,
		"path": "../public/assets/google-shared-tRQnG-Em.js"
	},
	"/assets/index-Bx0T779d.css": {
		"type": "text/css; charset=utf-8",
		"etag": "\"1a1d3-FMr7VhpewS6CFQvkYikzsRSP8Bo\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 106963,
		"path": "../public/assets/index-Bx0T779d.css"
	},
	"/assets/json-parse-DkU7w4CV.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"f3c-9Q4oRhy88j2/XyOoQpVT9G5cZS8\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 3900,
		"path": "../public/assets/json-parse-DkU7w4CV.js"
	},
	"/assets/mistral-CENPQLcK.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"c40be-twruseasijhm3gRt+0teWE/BerM\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 803006,
		"path": "../public/assets/mistral-CENPQLcK.js"
	},
	"/assets/og-image-BXZSfYNC.png": {
		"type": "image/png",
		"etag": "\"bdb5-FuriGfwXlgv5Zi3+xWvTQil/4tE\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 48565,
		"path": "../public/assets/og-image-BXZSfYNC.png"
	},
	"/assets/openai-5CK-qymG.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"19acb-rRBcAsUofu0QtzEc7kGMEUC1ORo\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 105163,
		"path": "../public/assets/openai-5CK-qymG.js"
	},
	"/assets/openai-codex-responses-C8p0Vi18.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"2a84-IMMDwuZ1xODsWoztzF1PyTRa6n8\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 10884,
		"path": "../public/assets/openai-codex-responses-C8p0Vi18.js"
	},
	"/assets/openai-completions-BS5UfJ7F.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"2ecc-wTGjvJ4p2WIvNglGsXZX/d/GcjI\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 11980,
		"path": "../public/assets/openai-completions-BS5UfJ7F.js"
	},
	"/assets/openai-responses-COlos0lj.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"c44-ioIQ2sQBccRu1czGcmxRMC2GNSY\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 3140,
		"path": "../public/assets/openai-responses-COlos0lj.js"
	},
	"/assets/openai-responses-shared-BOjfwMZK.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"1d22-3U5vB/FAb54h1K8JLkDxGMtcfI4\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 7458,
		"path": "../public/assets/openai-responses-shared-BOjfwMZK.js"
	},
	"/assets/transform-messages-BFoU07sj.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"84b-+W3r8OSam/simMMVCCRZ1SLgSSE\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 2123,
		"path": "../public/assets/transform-messages-BFoU07sj.js"
	},
	"/assets/pdf.worker.min-Cpi8b8z3.mjs": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"10094f-h6w+qYLbNnAGCagKJ9MgnlyRzTU\"",
		"mtime": "2026-04-10T14:02:37.049Z",
		"size": 1050959,
		"path": "../public/assets/pdf.worker.min-Cpi8b8z3.mjs"
	},
	"/workbox-66610c77.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"53c5-mgzUyuLPVfNfn2QRhXQ5JPeCVf0\"",
		"mtime": "2026-04-10T14:02:38.459Z",
		"size": 21445,
		"path": "../public/workbox-66610c77.js"
	},
	"/assets/main-Bx0T779d.css": {
		"type": "text/css; charset=utf-8",
		"etag": "\"1a1d3-FMr7VhpewS6CFQvkYikzsRSP8Bo\"",
		"mtime": "2026-04-10T14:02:38.460Z",
		"size": 106963,
		"path": "../public/assets/main-Bx0T779d.css"
	},
	"/main.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"28f29-wKAEN00kD6qTRF/ttluE46/6F+g\"",
		"mtime": "2026-04-10T14:02:38.460Z",
		"size": 167721,
		"path": "../public/main.js"
	},
	"/assets/index-ifmBFxIW.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"42818b-kZY8WphoW31gpX+rCpUpXTU18A8\"",
		"mtime": "2026-04-10T14:02:37.035Z",
		"size": 4358539,
		"path": "../public/assets/index-ifmBFxIW.js"
	},
	"/assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm": {
		"type": "application/wasm",
		"etag": "\"1498773-N7GIVhFmSX4+NP896opqX4E3nfI\"",
		"mtime": "2026-04-10T14:02:37.039Z",
		"size": 21596019,
		"path": "../public/assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm"
	}
};
//#endregion
//#region #nitro/virtual/public-assets-node
function readAsset(id) {
	const serverDir = dirname(fileURLToPath(globalThis.__nitro_main__));
	return promises.readFile(resolve(serverDir, public_assets_data_default[id].path));
}
//#endregion
//#region #nitro/virtual/public-assets
var publicAssetBases = {};
function isPublicAssetURL(id = "") {
	if (public_assets_data_default[id]) return true;
	for (const base in publicAssetBases) if (id.startsWith(base)) return true;
	return false;
}
function getAsset(id) {
	return public_assets_data_default[id];
}
//#endregion
//#region node_modules/nitro/dist/runtime/internal/static.mjs
var METHODS = new Set(["HEAD", "GET"]);
var EncodingMap = {
	gzip: ".gz",
	br: ".br",
	zstd: ".zst"
};
var static_default = defineHandler((event) => {
	if (event.req.method && !METHODS.has(event.req.method)) return;
	let id = decodePath(withLeadingSlash(withoutTrailingSlash(event.url.pathname)));
	let asset;
	const encodings = [...(event.req.headers.get("accept-encoding") || "").split(",").map((e) => EncodingMap[e.trim()]).filter(Boolean).sort(), ""];
	for (const encoding of encodings) for (const _id of [id + encoding, joinURL(id, "index.html" + encoding)]) {
		const _asset = getAsset(_id);
		if (_asset) {
			asset = _asset;
			id = _id;
			break;
		}
	}
	if (!asset) {
		if (isPublicAssetURL(id)) {
			event.res.headers.delete("Cache-Control");
			throw new HTTPError({ status: 404 });
		}
		return;
	}
	if (encodings.length > 1) event.res.headers.append("Vary", "Accept-Encoding");
	if (event.req.headers.get("if-none-match") === asset.etag) {
		event.res.status = 304;
		event.res.statusText = "Not Modified";
		return "";
	}
	const ifModifiedSinceH = event.req.headers.get("if-modified-since");
	const mtimeDate = new Date(asset.mtime);
	if (ifModifiedSinceH && asset.mtime && new Date(ifModifiedSinceH) >= mtimeDate) {
		event.res.status = 304;
		event.res.statusText = "Not Modified";
		return "";
	}
	if (asset.type) event.res.headers.set("Content-Type", asset.type);
	if (asset.etag && !event.res.headers.has("ETag")) event.res.headers.set("ETag", asset.etag);
	if (asset.mtime && !event.res.headers.has("Last-Modified")) event.res.headers.set("Last-Modified", mtimeDate.toUTCString());
	if (asset.encoding && !event.res.headers.has("Content-Encoding")) event.res.headers.set("Content-Encoding", asset.encoding);
	if (asset.size > 0 && !event.res.headers.has("Content-Length")) event.res.headers.set("Content-Length", asset.size.toString());
	return readAsset(id);
});
//#endregion
//#region #nitro/virtual/routing
var findRouteRules = /* @__PURE__ */ (() => {
	const $0 = [{
		name: "headers",
		route: "/assets/**",
		handler: headers,
		options: { "cache-control": "public, max-age=31536000, immutable" }
	}];
	return (m, p) => {
		let r = [];
		if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1) || "/";
		let s = p.split("/");
		if (s.length > 1) {
			if (s[1] === "assets") r.unshift({
				data: $0,
				params: { "_": s.slice(2).join("/") }
			});
		}
		return r;
	};
})();
var _lazy_QRZhZl = defineLazyEventHandler(() => import("./_chunks/renderer-template.mjs"));
var findRoute = /* @__PURE__ */ (() => {
	const data = {
		route: "/**",
		handler: _lazy_QRZhZl
	};
	return ((_m, p) => {
		return {
			data,
			params: { "_": p.slice(1) }
		};
	});
})();
var globalMiddleware = [toEventHandler(static_default)].filter(Boolean);
//#endregion
//#region node_modules/nitro/dist/runtime/internal/app.mjs
var APP_ID = "default";
function useNitroApp() {
	let instance = useNitroApp._instance;
	if (instance) return instance;
	instance = useNitroApp._instance = createNitroApp();
	globalThis.__nitro__ = globalThis.__nitro__ || {};
	globalThis.__nitro__[APP_ID] = instance;
	return instance;
}
function createNitroApp() {
	const hooks = void 0;
	const captureError = (error, errorCtx) => {
		if (errorCtx?.event) {
			const errors = errorCtx.event.req.context?.nitro?.errors;
			if (errors) errors.push({
				error,
				context: errorCtx
			});
		}
	};
	const h3App = createH3App({ onError(error, event) {
		return error_handler_default(error, event);
	} });
	let appHandler = (req) => {
		req.context ||= {};
		req.context.nitro = req.context.nitro || { errors: [] };
		return h3App.fetch(req);
	};
	return {
		fetch: appHandler,
		h3: h3App,
		hooks,
		captureError
	};
}
function createH3App(config) {
	const h3App = new H3Core(config);
	h3App["~findRoute"] = (event) => findRoute(event.req.method, event.url.pathname);
	h3App["~middleware"].push(...globalMiddleware);
	h3App["~getMiddleware"] = (event, route) => {
		const pathname = event.url.pathname;
		const method = event.req.method;
		const middleware = [];
		{
			const routeRules = getRouteRules(method, pathname);
			event.context.routeRules = routeRules?.routeRules;
			if (routeRules?.routeRuleMiddleware.length) middleware.push(...routeRules.routeRuleMiddleware);
		}
		middleware.push(...h3App["~middleware"]);
		if (route?.data?.middleware?.length) middleware.push(...route.data.middleware);
		return middleware;
	};
	return h3App;
}
function getRouteRules(method, pathname) {
	const m = findRouteRules(method, pathname);
	if (!m?.length) return { routeRuleMiddleware: [] };
	const routeRules = {};
	for (const layer of m) for (const rule of layer.data) {
		const currentRule = routeRules[rule.name];
		if (currentRule) {
			if (rule.options === false) {
				delete routeRules[rule.name];
				continue;
			}
			if (typeof currentRule.options === "object" && typeof rule.options === "object") currentRule.options = {
				...currentRule.options,
				...rule.options
			};
			else currentRule.options = rule.options;
			currentRule.route = rule.route;
			currentRule.params = {
				...currentRule.params,
				...layer.params
			};
		} else if (rule.options !== false) routeRules[rule.name] = {
			...rule,
			params: layer.params
		};
	}
	const middleware = [];
	for (const rule of Object.values(routeRules)) {
		if (rule.options === false || !rule.handler) continue;
		middleware.push(rule.handler(rule));
	}
	return {
		routeRules,
		routeRuleMiddleware: middleware
	};
}
//#endregion
//#region node_modules/nitro/dist/runtime/internal/error/hooks.mjs
function _captureError(error, type) {
	console.error(`[${type}]`, error);
	useNitroApp().captureError?.(error, { tags: [type] });
}
function trapUnhandledErrors() {
	process.on("unhandledRejection", (error) => _captureError(error, "unhandledRejection"));
	process.on("uncaughtException", (error) => _captureError(error, "uncaughtException"));
}
//#endregion
//#region node_modules/nitro/dist/presets/node/runtime/node-server.mjs
var _parsedPort = Number.parseInt(process.env.NITRO_PORT ?? process.env.PORT ?? "");
var port = Number.isNaN(_parsedPort) ? 3e3 : _parsedPort;
var host = process.env.NITRO_HOST || process.env.HOST;
var cert = process.env.NITRO_SSL_CERT;
var key = process.env.NITRO_SSL_KEY;
var nitroApp = useNitroApp();
serve({
	port,
	hostname: host,
	tls: cert && key ? {
		cert,
		key
	} : void 0,
	fetch: nitroApp.fetch
});
trapUnhandledErrors();
var node_server_default = {};
//#endregion
export { node_server_default as default };
