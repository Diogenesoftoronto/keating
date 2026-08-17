import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Gun from "gun";
import { WebSocketServer } from "ws";

const rawPort = process.env.GUN_RELAY_PORT ?? process.env.PORT ?? "8765";
const port = Number.parseInt(rawPort, 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error(`Invalid GUN relay port: ${rawPort}`);
}

const dataFile = process.env.GUN_RELAY_DATA?.trim() || ".keating/gun-relay/data";
mkdirSync(dirname(dataFile), { recursive: true });
const peers = (process.env.GUN_RELAY_PEERS ?? "")
	.split(",")
	.map((peer) => peer.trim())
	.filter(Boolean);

const server = createServer((request, response) => {
	if (request.url === "/health") {
		response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
		response.end(JSON.stringify({ ok: true, service: "keating-gun-relay" }));
		return;
	}
	if (Gun.serve(request, response)) return;
	response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
	response.end("Not found");
});

const webSocketServer = new WebSocketServer({ server, path: "/gun" });
webSocketServer.prependListener("connection", (socket) => {
	const emit = socket.emit.bind(socket);
	socket.emit = (event, ...arguments_) => {
		if (event === "message" && arguments_[1] === false && Buffer.isBuffer(arguments_[0])) {
			arguments_[0] = arguments_[0].toString("utf8");
		}
		return emit(event, ...arguments_);
	};
});

const gun = Gun({
	web: server,
	ws: { web: webSocketServer, path: "/gun" },
	file: dataFile,
	peers,
	localStorage: false,
	axe: false,
	multicast: false,
});

server.listen(port, "0.0.0.0", () => {
	console.log(`Keating GUN relay listening on http://0.0.0.0:${port}/gun`);
});

let shuttingDown = false;
function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`Received ${signal}; closing Keating GUN relay.`);
	const forcedExit = setTimeout(() => {
		console.error("Keating GUN relay did not close within five seconds.");
		process.exit(1);
	}, 5_000);
	forcedExit.unref();
	for (const client of webSocketServer.clients) client.terminate();
	webSocketServer.close();
	server.closeAllConnections?.();
	server.close((error) => {
		clearTimeout(forcedExit);
		if (error) {
			console.error(error);
		}
		process.exit(error ? 1 : 0);
	});
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void gun;
