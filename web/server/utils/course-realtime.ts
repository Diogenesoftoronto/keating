import type { Peer } from "crossws";
import type { CourseRealtimeMessage } from "../../src/courses/contracts";

interface CourseRealtimePeer {
	peer: Peer;
	accountId: string;
}

interface CourseRealtimeGlobals {
	__keatingCoursePeers?: Map<string, Map<string, CourseRealtimePeer>>;
}

const globals = globalThis as typeof globalThis & CourseRealtimeGlobals;
const coursePeers = globals.__keatingCoursePeers ??= new Map<string, Map<string, CourseRealtimePeer>>();

function send(peer: Peer, message: CourseRealtimeMessage): void {
	peer.send(JSON.stringify(message));
}

function peersFor(courseId: string): Map<string, CourseRealtimePeer> {
	let peers = coursePeers.get(courseId);
	if (!peers) {
		peers = new Map();
		coursePeers.set(courseId, peers);
	}
	return peers;
}

function broadcastPresence(courseId: string): void {
	const peers = coursePeers.get(courseId);
	if (!peers) return;
	const accountIds = [...new Set([...peers.values()].map((connection) => connection.accountId))];
	const message: CourseRealtimeMessage = { type: "presence", courseId, accountIds };
	for (const connection of peers.values()) send(connection.peer, message);
}

export function connectCoursePeer(courseId: string, accountId: string, peer: Peer): void {
	peersFor(courseId).set(peer.id, { peer, accountId });
	broadcastPresence(courseId);
}

export function disconnectCoursePeer(courseId: string, peer: Peer): void {
	const peers = coursePeers.get(courseId);
	if (!peers) return;
	peers.delete(peer.id);
	if (peers.size === 0) coursePeers.delete(courseId);
	else broadcastPresence(courseId);
}

export function broadcastCourseUpdated(courseId: string, revision: number): void {
	const peers = coursePeers.get(courseId);
	if (!peers) return;
	const message: CourseRealtimeMessage = { type: "course.updated", courseId, revision };
	for (const connection of peers.values()) send(connection.peer, message);
}
