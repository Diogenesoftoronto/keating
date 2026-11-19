const [{ ensureCourseAccountSession }, room] = await Promise.all([
  import("/src/courses/account-session.ts"),
  import("/src/rooms/client.ts"),
]);
if (location.origin !== new URL(base).origin || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
  throw new Error("Room fixtures require the loopback app.");
}
await ensureCourseAccountSession();
const response = await fetch("/api/courses/session");
const { account } = await response.json();
if (!response.ok || account?.mode !== "local") {
  throw new Error("Room fixtures require a browser-local course account.");
}
const snapshot = await room.createRoom(data.input);
for (const operation of data.operations) {
  await room.applyRoomOperation(snapshot.room.id, operation);
}
