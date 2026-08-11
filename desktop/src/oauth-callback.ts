import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** The fixed loopback boundary used by the desktop OAuth redirect receiver. */
export const OAUTH_CALLBACK_HOST = "127.0.0.1";
export const DEFAULT_OAUTH_CALLBACK_PORT = 1455;
export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const MAX_OAUTH_CALLBACK_URL_BYTES = 4 * 1024;
export const MAX_OAUTH_CALLBACK_QUERY_BYTES = 2 * 1024;
export const MAX_OAUTH_CALLBACK_HEADER_BYTES = 8 * 1024;
export const DEFAULT_OAUTH_CALLBACK_REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_OAUTH_CALLBACK_HEADERS_TIMEOUT_MS = 2_000;
export const DEFAULT_OAUTH_CALLBACK_KEEP_ALIVE_TIMEOUT_MS = 1_000;

const MAX_OAUTH_CALLBACK_HEADERS = 16;
const RETURN_TO_KEATING_HTML = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Return to Keating</title><p>Keating received the callback. Return to Keating to confirm sign-in; this window may now be closed.</p></html>";
const CALLBACK_ERROR_HTML = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Keating sign-in</title><p>Keating could not accept this callback. Return to Keating and try again.</p></html>";
const CALLBACK_ALREADY_USED_HTML = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Keating sign-in</title><p>This sign-in callback was already used. Return to Keating.</p></html>";

export interface OAuthLoopbackCallback {
	/** Canonical 127.0.0.1 callback URL. It is never derived from the Host header. */
	url: URL;
	code: string;
	state: string;
}

export interface OAuthCallbackReceiverOptions {
	/** Defaults to 1455. Supplying 0 is useful for isolated tests. */
	port?: number;
	requestTimeoutMs?: number;
	headersTimeoutMs?: number;
	keepAliveTimeoutMs?: number;
	onCallback: (callback: OAuthLoopbackCallback) => void | Promise<void>;
}

export interface OAuthCallbackReceiverConfiguration {
	host: typeof OAUTH_CALLBACK_HOST;
	port: number;
	requestTimeoutMs: number;
	headersTimeoutMs: number;
	keepAliveTimeoutMs: number;
	maxHeaderBytes: number;
}

export interface OAuthCallbackReceiver {
	origin: string;
	configuration: OAuthCallbackReceiverConfiguration;
	/** Safe to call repeatedly, including while another caller is stopping it. */
	stop(): Promise<void>;
}

export interface OAuthCallbackReceiverUnavailable {
	available: false;
	reason: "port-unavailable" | "listen-failed";
	/** The desktop shell should offer manual callback URL paste when this occurs. */
	action: "manual-paste";
	message: string;
}

export interface OAuthCallbackReceiverAvailable {
	available: true;
	receiver: OAuthCallbackReceiver;
}

export type OAuthCallbackReceiverStartResult = OAuthCallbackReceiverAvailable | OAuthCallbackReceiverUnavailable;

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function boundedTimeout(value: number | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) return fallback;
	return value;
}

function requestedPort(value: number | undefined): number {
	if (value === undefined) return DEFAULT_OAUTH_CALLBACK_PORT;
	if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) return DEFAULT_OAUTH_CALLBACK_PORT;
	return value;
}

function hasRequestBody(request: IncomingMessage): boolean {
	const contentLength = request.headers["content-length"];
	if (request.headers["transfer-encoding"] !== undefined) return true;
	if (contentLength === undefined) return false;
	// OAuth redirects have no request body. Reject malformed or repeated
	// Content-Length values too, rather than leaving a stream unread.
	return typeof contentLength !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(contentLength) || contentLength !== "0";
}

function staticResponse(response: ServerResponse, statusCode: number, body: string, allowGet = false): void {
	response.writeHead(statusCode, {
		"cache-control": "no-store",
		"content-length": String(byteLength(body)),
		"content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'",
		"content-type": "text/html; charset=utf-8",
		"referrer-policy": "no-referrer",
		...(allowGet ? { allow: "GET" } : {}),
		"x-content-type-options": "nosniff",
	});
	response.end(body);
}

function normalizedCallback(requestUrl: string, origin: string): OAuthLoopbackCallback | null {
	if (!requestUrl.startsWith("/") || requestUrl.startsWith("//")) return null;
	if (byteLength(requestUrl) > MAX_OAUTH_CALLBACK_URL_BYTES) return null;
	if (/%(?![0-9A-Fa-f]{2})/.test(requestUrl)) return null;

	let parsed: URL;
	try {
		parsed = new URL(requestUrl, origin);
	} catch {
		return null;
	}
	if (parsed.pathname !== OAUTH_CALLBACK_PATH || byteLength(parsed.search) > MAX_OAUTH_CALLBACK_QUERY_BYTES) return null;
	const codes = parsed.searchParams.getAll("code");
	const states = parsed.searchParams.getAll("state");
	if (codes.length !== 1 || states.length !== 1 || codes[0].length === 0 || states[0].length === 0) return null;

	// Rebuild under our loopback origin so neither a hostile Host header nor an
	// absolute-form request can influence the value given to the OAuth consumer.
	const url = new URL(OAUTH_CALLBACK_PATH, origin);
	for (const [key, value] of parsed.searchParams) url.searchParams.append(key, value);
	return { url, code: codes[0], state: states[0] };
}

function currentOrigin(server: Server): string | null {
	const address = server.address();
	if (!address || typeof address === "string") return null;
	return `http://${OAUTH_CALLBACK_HOST}:${address.port}`;
}

function stopServer(server: Server): Promise<void> {
	return new Promise((resolve) => {
		server.close((error) => {
			// A concurrent shutdown can make close report ERR_SERVER_NOT_RUNNING.
			if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
				resolve();
				return;
			}
			resolve();
		});
	});
}

/**
 * Starts the intentionally narrow localhost OAuth callback endpoint. It never
 * logs, forwards, or renders OAuth values; consumers receive them only through
 * the in-process callback. A bind failure is recoverable through manual paste.
 */
export async function startOAuthCallbackReceiver(
	options: OAuthCallbackReceiverOptions,
): Promise<OAuthCallbackReceiverStartResult> {
	const port = requestedPort(options.port);
	const requestTimeoutMs = boundedTimeout(options.requestTimeoutMs, DEFAULT_OAUTH_CALLBACK_REQUEST_TIMEOUT_MS);
	const headersTimeoutMs = Math.min(
		boundedTimeout(options.headersTimeoutMs, DEFAULT_OAUTH_CALLBACK_HEADERS_TIMEOUT_MS),
		requestTimeoutMs,
	);
	const keepAliveTimeoutMs = boundedTimeout(options.keepAliveTimeoutMs, DEFAULT_OAUTH_CALLBACK_KEEP_ALIVE_TIMEOUT_MS);
	let accepted = false;

	const server = createServer({ maxHeaderSize: MAX_OAUTH_CALLBACK_HEADER_BYTES }, (request, response) => {
		void (async () => {
			if (request.method !== "GET") {
				staticResponse(response, 405, CALLBACK_ERROR_HTML, true);
				return;
			}
			if (hasRequestBody(request)) {
				staticResponse(response, 400, CALLBACK_ERROR_HTML);
				return;
			}
			const origin = currentOrigin(server);
			const callback = origin && request.url ? normalizedCallback(request.url, origin) : null;
			if (!callback) {
				staticResponse(response, 400, CALLBACK_ERROR_HTML);
				return;
			}
			if (accepted) {
				staticResponse(response, 410, CALLBACK_ALREADY_USED_HTML);
				return;
			}

			accepted = true;
			try {
				await options.onCallback(callback);
				staticResponse(response, 200, RETURN_TO_KEATING_HTML);
			} catch {
				staticResponse(response, 500, CALLBACK_ERROR_HTML);
			}
		})();
	});
	server.requestTimeout = requestTimeoutMs;
	server.headersTimeout = headersTimeoutMs;
	server.keepAliveTimeout = keepAliveTimeoutMs;
	server.maxHeadersCount = MAX_OAUTH_CALLBACK_HEADERS;
	server.on("clientError", (error, socket) => {
		// Parser errors (including header overflow) must not expose parser detail.
		void error;
		socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
	});

	const listening = await new Promise<OAuthCallbackReceiverStartResult>((resolve) => {
		const unavailable = (error: NodeJS.ErrnoException) => {
			cleanup();
			resolve({
				available: false,
				reason: error.code === "EADDRINUSE" ? "port-unavailable" : "listen-failed",
				action: "manual-paste",
				message: "Keating could not open its secure local sign-in receiver. Paste the callback URL into Keating to finish sign-in.",
			});
		};
		const ready = () => {
			cleanup();
			const origin = currentOrigin(server);
			if (!origin) {
				resolve({
					available: false,
					reason: "listen-failed",
					action: "manual-paste",
					message: "Keating could not open its secure local sign-in receiver. Paste the callback URL into Keating to finish sign-in.",
				});
				return;
			}
			let stopping: Promise<void> | undefined;
			resolve({
				available: true,
				receiver: {
					origin,
					configuration: {
						host: OAUTH_CALLBACK_HOST,
						port: new URL(origin).port === "" ? 80 : Number(new URL(origin).port),
						requestTimeoutMs,
						headersTimeoutMs,
						keepAliveTimeoutMs,
						maxHeaderBytes: MAX_OAUTH_CALLBACK_HEADER_BYTES,
					},
					stop: () => {
						stopping ??= stopServer(server);
						return stopping;
					},
				},
			});
		};
		const cleanup = () => {
			server.off("error", unavailable);
			server.off("listening", ready);
		};
		server.once("error", unavailable);
		server.once("listening", ready);
		try {
			// `host` is the security boundary. `exclusive` is only meaningful for
			// Node clusters and is incompatible with Bun's ephemeral-port listener.
			server.listen({ host: OAUTH_CALLBACK_HOST, port });
		} catch (error) {
			unavailable(error as NodeJS.ErrnoException);
		}
	});

	if (!listening.available) {
		await stopServer(server);
	}
	return listening;
}
