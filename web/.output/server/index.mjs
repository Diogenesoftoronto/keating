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
	"/favicon.svg": {
		"type": "image/svg+xml",
		"etag": "\"1d3-vyCqW50L04maiE9pHTf/6Zl/pwc\"",
		"mtime": "2026-04-10T15:03:40.359Z",
		"size": 467,
		"path": "../public/favicon.svg"
	},
	"/apple-touch-icon.svg": {
		"type": "image/svg+xml",
		"etag": "\"1dc-ERPhA59WPG9PMagrYJyjsSPZSZA\"",
		"mtime": "2026-04-10T15:03:40.359Z",
		"size": 476,
		"path": "../public/apple-touch-icon.svg"
	},
	"/manifest.webmanifest": {
		"type": "application/manifest+json",
		"etag": "\"1f6-u0s1NgHJ89kWW2Gl9++DGvfLpfk\"",
		"mtime": "2026-04-10T15:03:39.309Z",
		"size": 502,
		"path": "../public/manifest.webmanifest"
	},
	"/pwa-512x512.svg": {
		"type": "image/svg+xml",
		"etag": "\"1de-5WPQ8aJg53aQBSL8iGuenOcTMfg\"",
		"mtime": "2026-04-10T15:03:40.359Z",
		"size": 478,
		"path": "../public/pwa-512x512.svg"
	},
	"/registerSW.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"86-uD38uo0sV8qINzJL85XzR0gDOlA\"",
		"mtime": "2026-04-10T15:03:39.309Z",
		"size": 134,
		"path": "../public/registerSW.js"
	},
	"/pwa-192x192.svg": {
		"type": "image/svg+xml",
		"etag": "\"1dc-ooucffMgzUhBK7rmKw4PJatSO3Q\"",
		"mtime": "2026-04-10T15:03:40.359Z",
		"size": 476,
		"path": "../public/pwa-192x192.svg"
	},
	"/sw.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"7be-WCqOwrGyIcQYteMxvvB6p75Oenw\"",
		"mtime": "2026-04-10T15:03:40.361Z",
		"size": 1982,
		"path": "../public/sw.js"
	},
	"/index.html": {
		"type": "text/html; charset=utf-8",
		"etag": "\"806-GqztWIkU17V4grMazbpX5yBkgP4\"",
		"mtime": "2026-04-10T15:03:40.361Z",
		"size": 2054,
		"path": "../public/index.html"
	},
	"/assets/anthropic-xqq8Eslo.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"1414c-w5I6+GTMDc9EZ+ybeYHH40z9sS8\"",
		"mtime": "2026-04-10T15:03:39.294Z",
		"size": 82252,
		"path": "../public/assets/anthropic-xqq8Eslo.js"
	},
	"/assets/azure-openai-responses-CXXNMOb0.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"ccf-Rya5BunfWkwG43bw77MHuhLT94c\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 3279,
		"path": "../public/assets/azure-openai-responses-CXXNMOb0.js"
	},
	"/assets/chunk-zsgVPwQN.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"4b7-qoD6wC3H+s7iAz/rFYIHzb3h3Pc\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 1207,
		"path": "../public/assets/chunk-zsgVPwQN.js"
	},
	"/assets/env-api-keys-BNlMKqxw.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"686-B4WiAHA1HOSaw9KIMTziKRveVC4\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 1670,
		"path": "../public/assets/env-api-keys-BNlMKqxw.js"
	},
	"/assets/event-stream-D33K9rpL.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"3d5da-5tf9hsVX+Q4W+DrCSlVvLlbdu0Q\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 251354,
		"path": "../public/assets/event-stream-D33K9rpL.js"
	},
	"/assets/github-copilot-headers-CrI0CIJ7.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"195-eSLn8DOae6cc1ZXmmdKLKlPMtZY\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 405,
		"path": "../public/assets/github-copilot-headers-CrI0CIJ7.js"
	},
	"/assets/google-DJCwMmG-.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"15f4-q4lDgXDKt0kOuiQToRYg7K+YPj0\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 5620,
		"path": "../public/assets/google-DJCwMmG-.js"
	},
	"/assets/google-gemini-cli-DFwCe_11.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"2b73-mEdxH9zJqJSIehdkYzkL3ZTQUS4\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 11123,
		"path": "../public/assets/google-gemini-cli-DFwCe_11.js"
	},
	"/workbox-66610c77.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"53c5-mgzUyuLPVfNfn2QRhXQ5JPeCVf0\"",
		"mtime": "2026-04-10T15:03:40.361Z",
		"size": 21445,
		"path": "../public/workbox-66610c77.js"
	},
	"/assets/google-vertex-CgDFoSow.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"18b8-tCKswnWqlfIsjLU8R4BVhQR9eRk\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 6328,
		"path": "../public/assets/google-vertex-CgDFoSow.js"
	},
	"/assets/hash-Bt1aVMQ3.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"156-hvAekKPf4hZG/C7uJoGe6PJ0/0Q\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 342,
		"path": "../public/assets/hash-Bt1aVMQ3.js"
	},
	"/assets/google-shared-C8sOtfQi.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"40368-flHkoK7ckv8FWOvPgQsM3t1jaow\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 263016,
		"path": "../public/assets/google-shared-C8sOtfQi.js"
	},
	"/assets/index-DrR2gedj.css": {
		"type": "text/css; charset=utf-8",
		"etag": "\"1a8be-rrl7/c3egg9nW/zqtSiyCAZsmYw\"",
		"mtime": "2026-04-10T15:03:39.297Z",
		"size": 108734,
		"path": "../public/assets/index-DrR2gedj.css"
	},
	"/assets/json-parse-CUtfuw3W.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"f35-7umXnztyxY6SpEze9/QGd98Dew0\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 3893,
		"path": "../public/assets/json-parse-CUtfuw3W.js"
	},
	"/study.pdf": {
		"type": "application/pdf",
		"etag": "\"40f9c-giqKfYdTsY8yHY7NSIOXOM009l0\"",
		"mtime": "2026-04-10T15:03:40.359Z",
		"size": 266140,
		"path": "../public/study.pdf"
	},
	"/main.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"2b0eb-3hmol7ua7USCJlCpnbFB3g7OkQI\"",
		"mtime": "2026-04-10T15:03:40.361Z",
		"size": 176363,
		"path": "../public/main.js"
	},
	"/assets/openai-codex-responses-_dJ0s5Pv.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"2ab3-h6zc9YultNDopT6ihEGX4UAc1MI\"",
		"mtime": "2026-04-10T15:03:39.296Z",
		"size": 10931,
		"path": "../public/assets/openai-codex-responses-_dJ0s5Pv.js"
	},
	"/assets/openai-Cn7eGqwa.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"19acb-rRBcAsUofu0QtzEc7kGMEUC1ORo\"",
		"mtime": "2026-04-10T15:03:39.296Z",
		"size": 105163,
		"path": "../public/assets/openai-Cn7eGqwa.js"
	},
	"/assets/openai-responses-BeI1Yb8V.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"c49-VIn0U3qokuu2rfiOPXc+9oRJG1U\"",
		"mtime": "2026-04-10T15:03:39.296Z",
		"size": 3145,
		"path": "../public/assets/openai-responses-BeI1Yb8V.js"
	},
	"/assets/openai-completions-BUCGAM6C.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"2ecc-gfWKQNw5WMku2jzkoqfYi7rTou0\"",
		"mtime": "2026-04-10T15:03:39.296Z",
		"size": 11980,
		"path": "../public/assets/openai-completions-BUCGAM6C.js"
	},
	"/assets/openai-responses-shared-B6johsNp.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"1d22-FxXNDMNBdoRH0cmgoSECg8METiM\"",
		"mtime": "2026-04-10T15:03:39.296Z",
		"size": 7458,
		"path": "../public/assets/openai-responses-shared-B6johsNp.js"
	},
	"/assets/main-DrR2gedj.css": {
		"type": "text/css; charset=utf-8",
		"etag": "\"1a8be-rrl7/c3egg9nW/zqtSiyCAZsmYw\"",
		"mtime": "2026-04-10T15:03:40.361Z",
		"size": 108734,
		"path": "../public/assets/main-DrR2gedj.css"
	},
	"/assets/preload-helper-DSXbuxSR.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"4a9-jUfFKCyfaRG0LCmrRFreK8BlWnM\"",
		"mtime": "2026-04-10T15:03:39.296Z",
		"size": 1193,
		"path": "../public/assets/preload-helper-DSXbuxSR.js"
	},
	"/assets/transform-messages-XKqwKV3D.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"84b-+W3r8OSam/simMMVCCRZ1SLgSSE\"",
		"mtime": "2026-04-10T15:03:39.296Z",
		"size": 2123,
		"path": "../public/assets/transform-messages-XKqwKV3D.js"
	},
	"/assets/mistral-CfUjxWyf.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"c40da-tcOCNTs2Cc8LzGr7ydQ5i57JUio\"",
		"mtime": "2026-04-10T15:03:39.295Z",
		"size": 803034,
		"path": "../public/assets/mistral-CfUjxWyf.js"
	},
	"/assets/transformers.web-BrP0OQ6I.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"cee2d-grmeuCZMXtzOpshYc6k4fx0nVjM\"",
		"mtime": "2026-04-10T15:03:39.296Z",
		"size": 847405,
		"path": "../public/assets/transformers.web-BrP0OQ6I.js"
	},
	"/assets/pdf.worker.min-Cpi8b8z3.mjs": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"10094f-h6w+qYLbNnAGCagKJ9MgnlyRzTU\"",
		"mtime": "2026-04-10T15:03:39.307Z",
		"size": 1050959,
		"path": "../public/assets/pdf.worker.min-Cpi8b8z3.mjs"
	},
	"/assets/index-DVRHlzdR.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"363c25-glO2CrpRIHFA7Yr+4AuW/7joqp0\"",
		"mtime": "2026-04-10T15:03:39.292Z",
		"size": 3554341,
		"path": "../public/assets/index-DVRHlzdR.js"
	},
	"/assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm": {
		"type": "application/wasm",
		"etag": "\"1498773-N7GIVhFmSX4+NP896opqX4E3nfI\"",
		"mtime": "2026-04-10T15:03:39.297Z",
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
