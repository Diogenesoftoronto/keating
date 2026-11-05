import { afterEach, describe, expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createRoomTools } from "../keating/browser-tools/rooms";
import { courseCollaborationPrompt } from "../keating/browser-tools/courses";
import { TOOL_REGISTRATION_ORDER } from "../keating/browser-tools";
import { BASELINE_TEACHING_TOOLS } from "../keating/capabilities";
import { classifyTool } from "../keating/security";

const originalFetch = globalThis.fetch;
const NOW = "2026-11-05T12:00:00.000Z";

type Captured = { url: string; method: string; body: Record<string, any> };

function viewerSnapshot(
  overrides: {
    id?: string;
    title?: string;
    status?: "open" | "ended";
    role?: string;
    canInvite?: boolean;
    canPost?: boolean;
    inviteRoles?: string[];
  } = {},
) {
  return {
    room: {
      id: overrides.id ?? "room_new",
      title: overrides.title ?? "Recursion study session",
      status: overrides.status ?? "open",
    },
    viewer: { accountId: "learner_1", role: overrides.role ?? "host" },
    permissions: {
      canPost: overrides.canPost ?? true,
      canOversee: true,
      canManageRoles: true,
      canInvite: overrides.canInvite ?? true,
      inviteRoles: overrides.inviteRoles ?? ["learner", "teacher", "observer"],
      canFacilitate: true,
      isFacilitator: false,
    },
    hasEarlierMessages: false,
  };
}

function invite(role = "learner", maxUses = 30) {
  return {
    invite: {
      id: "invite_1",
      role,
      createdBy: "learner_1",
      createdAt: NOW,
      expiresAt: "2026-11-08T12:00:00.000Z",
      maxUses,
      uses: 0,
    },
    token: "tok_abc123",
  };
}

function mockFetch(
  route: (request: Captured) => Response | Promise<Response>,
): Captured[] {
  const requests: Captured[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : {},
    };
    requests.push(request);
    return route(request);
  }) as typeof fetch;
  return requests;
}

function failure(status: number, statusMessage: string, code?: string) {
  return Response.json(
    { statusMessage, ...(code ? { data: { code } } : {}) },
    { status },
  );
}

async function runTool(
  name: string,
  params: Record<string, unknown> = {},
): Promise<string> {
  const tool = createRoomTools().find(
    (candidate: AgentTool) => candidate.name === name,
  );
  expect(tool, `${name} should be registered`).toBeDefined();
  const result = (await tool!.execute!(`call_${name}`, params as never)) as unknown as {
    content: Array<{ type: string; text: string }>;
  };
  return result.content.map((part) => part.text).join("\n");
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("study room tools", () => {
  test("opens a new room from agreed details and returns a learner invite", async () => {
    const requests = mockFetch(({ url, method }) => {
      if (url === "/api/rooms" && method === "POST")
        return Response.json(viewerSnapshot());
      if (url === "/api/rooms/room_new/invites") return Response.json(invite());
      throw new Error(`unexpected ${method} ${url}`);
    });

    const result = await runTool("room_invite", {
      title: "Recursion study session",
      topic: "Base cases and the call stack",
      goal: "Both of us can trace a recursive call by hand",
    });

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST /api/rooms",
      "POST /api/rooms/room_new/invites",
    ]);
    expect(requests[0]!.body).toEqual({
      title: "Recursion study session",
      topic: "Base cases and the call stack",
      goal: "Both of us can trace a recursive call by hand",
    });
    expect(requests[1]!.body).toEqual({
      role: "learner",
      expiresInHours: 72,
      maxUses: 30,
    });
    expect(result).toContain("## Study room invite ready");
    expect(result).toContain("[Recursion study session](/rooms/room_new)");
    expect(result).toContain("new room");
    expect(result).toContain("/rooms/join/tok_abc123");
    expect(result).toContain("Up to 30 people");
    expect(result).toContain("Expires:");
    expect(result).toContain("The learner sends this link themselves");
    expect(result).toContain("Keating has not contacted anyone");
    expect(result).not.toContain("Opening message");
  });

  test("uses the browser origin for an absolute invite link when available", async () => {
    const globals = globalThis as { window?: unknown };
    const previous = globals.window;
    globals.window = { location: { origin: "https://keating.help" } };
    try {
      mockFetch(({ url }) =>
        url === "/api/rooms"
          ? Response.json(viewerSnapshot())
          : Response.json(invite()),
      );
      const result = await runTool("room_invite", { title: "Pairing" });
      expect(result).toContain("https://keating.help/rooms/join/tok_abc123");
    } finally {
      if (previous === undefined) delete globals.window;
      else globals.window = previous;
    }
  });

  test("invites into an existing room after checking the learner may invite", async () => {
    const requests = mockFetch(({ url, method }) => {
      if (url === "/api/rooms/room_existing" && method === "GET")
        return Response.json(
          viewerSnapshot({ id: "room_existing", title: "Thesis circle" }),
        );
      if (url === "/api/rooms/room_existing/invites")
        return Response.json(invite("observer", 1));
      throw new Error(`unexpected ${method} ${url}`);
    });

    const result = await runTool("room_invite", {
      room_id: "room_existing",
      role: "observer",
      expires_in_hours: 24,
      max_uses: 1,
    });

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET /api/rooms/room_existing",
      "POST /api/rooms/room_existing/invites",
    ]);
    expect(requests[1]!.body).toEqual({
      role: "observer",
      expiresInHours: 24,
      maxUses: 1,
    });
    expect(result).toContain("[Thesis circle](/rooms/room_existing)");
    expect(result).not.toContain("new room");
    expect(result).toContain("Invite link (observer)");
    expect(result).toContain("Up to 1 person");
  });

  test("seeds the room with an approved opening message", async () => {
    const requests = mockFetch(({ url }) => {
      if (url === "/api/rooms") return Response.json(viewerSnapshot());
      if (url.endsWith("/invites")) return Response.json(invite());
      if (url.endsWith("/operations")) return Response.json(viewerSnapshot());
      throw new Error(`unexpected ${url}`);
    });

    const result = await runTool("room_invite", {
      title: "Recursion study session",
      opening_message: "  Let's trace factorial(3) together.  ",
    });

    const post = requests.find((r) => r.url === "/api/rooms/room_new/operations");
    expect(post?.method).toBe("POST");
    expect(post?.body).toMatchObject({
      type: "message.post",
      roomId: "room_new",
      body: "Let's trace factorial(3) together.",
    });
    expect(post?.body.messageId).toMatch(/^msg_[0-9a-f]+$/);
    expect(result).toContain("Opening message: posted");
  });

  test("keeps the invite when the opening message cannot be posted", async () => {
    mockFetch(({ url }) => {
      if (url === "/api/rooms") return Response.json(viewerSnapshot());
      if (url.endsWith("/invites")) return Response.json(invite());
      return failure(403, "A teacher has muted you in this room.", "room_muted");
    });
    const result = await runTool("room_invite", {
      title: "Recursion study session",
      opening_message: "Hello",
    });
    expect(result).toContain("/rooms/join/tok_abc123");
    expect(result).toContain("Opening message: not posted");
    expect(result).toContain("The invite link still works.");
  });

  test("refuses to invite when the learner's role in the room cannot", async () => {
    const requests = mockFetch(() =>
      Response.json(
        viewerSnapshot({
          id: "room_peer",
          title: "Peer room",
          role: "learner",
          canInvite: false,
          inviteRoles: [],
        }),
      ),
    );
    await expect(
      runTool("room_invite", { room_id: "room_peer" }),
    ).rejects.toThrow(/learner role in “Peer room” cannot invite/);
    expect(requests).toHaveLength(1);
  });

  test("requires an agreed title for a new room and rejects out-of-range limits", async () => {
    const requests = mockFetch(() => Response.json({}));
    await expect(runTool("room_invite", {})).rejects.toThrow(
      /title is required to open a new study room/,
    );
    await expect(
      runTool("room_invite", { title: "x", expires_in_hours: 1_000 }),
    ).rejects.toThrow(/expires_in_hours must be a whole number from 1 to 720/);
    await expect(
      runTool("room_invite", { title: "x", max_uses: 0 }),
    ).rejects.toThrow(/max_uses must be a whole number from 1 to 200/);
    await expect(
      runTool("room_invite", { title: "x", role: "teacher" }),
    ).rejects.toThrow(/role/);
    expect(requests).toHaveLength(0);
  });

  test("maps room API failures to learner-facing text", async () => {
    const cases: Array<[Response, RegExp]> = [
      [failure(401, "Unauthorized"), /need a signed-in Keating account/],
      [
        failure(503, "Room account authorization is unavailable. Try again.", "notorganic_auth_adapter_unavailable"),
        /need a signed-in Keating account/,
      ],
      [failure(429, "Too many requests. Please try again shortly."), /rate limited/],
      [failure(500, "boom"), /not available on this server right now/],
    ];
    for (const [response, pattern] of cases) {
      mockFetch(() => response.clone());
      await expect(runTool("room_invite", { title: "x" })).rejects.toThrow(pattern);
    }

    mockFetch(() => failure(404, "Room not found.", "room_not_found"));
    await expect(
      runTool("room_invite", { room_id: "room_gone" }),
    ).rejects.toThrow(/not found.*Use room_list/);

    mockFetch(() => failure(429, "Too many requests. Please try again shortly."));
    await expect(runTool("room_list")).rejects.toThrow(
      /Could not list study rooms: room requests are rate limited/,
    );
  });

  test("reports the created room when the invite itself fails", async () => {
    mockFetch(({ url }) => {
      if (url === "/api/rooms") return Response.json(viewerSnapshot());
      return failure(409, "Too many open invitations. Revoke one first.", "room_invite_limit");
    });
    await expect(
      runTool("room_invite", { title: "Recursion study session" }),
    ).rejects.toThrow(
      /too many open invitations[\s\S]*room itself was created[\s\S]*\/rooms\/room_new/,
    );
  });

  test("lists the learner's rooms with role, status, and link", async () => {
    mockFetch(() =>
      Response.json({
        rooms: [
          {
            id: "room_a",
            title: "Thesis circle",
            topic: "Chapter 2 structure",
            role: "host",
            status: "open",
            memberCount: 3,
            hostName: "Learner",
            teacherNames: [],
            settings: {},
            updatedAt: NOW,
            joined: true,
          },
          {
            id: "room_b",
            title: "Old room",
            topic: "",
            role: "learner",
            status: "ended",
            memberCount: 1,
            courseTitle: "Algorithms",
            hostName: "Someone",
            teacherNames: [],
            settings: {},
            updatedAt: NOW,
            joined: true,
          },
        ],
      }),
    );
    const result = await runTool("room_list");
    expect(result).toContain(
      "- [Thesis circle](/rooms/room_a) · host · open · 3 members · topic: Chapter 2 structure · `room_a`",
    );
    expect(result).toContain(
      "- [Old room](/rooms/room_b) · learner · ended · 1 member · course: Algorithms · `room_b`",
    );

    mockFetch(() => Response.json({ rooms: [] }));
    expect(await runTool("room_list")).toContain("no study rooms yet");
  });

  test("is registered, classified, and visible like the course tools", () => {
    for (const name of ["room_list", "room_invite"]) {
      expect(TOOL_REGISTRATION_ORDER).toContain(name as never);
      expect(BASELINE_TEACHING_TOOLS.has(name)).toBe(true);
    }
    expect(classifyTool("room_list")).toMatchObject({ known: true, risk: "sensitive-read" });
    expect(classifyTool("room_invite")).toMatchObject({ known: true, risk: "state-change" });
    const description = createRoomTools().find((tool) => tool.name === "room_invite")!.description;
    expect(description).toContain("Only call this after the learner explicitly agrees to invite someone");
    expect(description).toContain("Never invent names or email addresses");
    expect(description).toContain("Keating never contacts the invitee");
    expect(courseCollaborationPrompt()).toContain("room_invite");
  });
});
