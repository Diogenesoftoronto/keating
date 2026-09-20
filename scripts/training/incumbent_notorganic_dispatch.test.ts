import { describe, expect, test } from "bun:test";
import { webcrypto } from "node:crypto";
import { NOTORGANIC_AUTH_ENV as ENV } from "../../src/core/notorganic-auth.js";
import { dispatchIncumbentNotOrganic, MAX_INPUT_BYTES, type IncumbentCredential } from "./incumbent_notorganic_dispatch.js";

const now = 1_800_000_000_000;
const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = await webcrypto.subtle.exportKey("jwk", keys.privateKey);
const request = { model: "gpt-incumbent-concrete", input: [{ role: "user", content: "private learner text" }], text: { format: { type: "json_object" } } };
const raw = JSON.stringify({ model: request.model, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "result" }] }], usage: { input_tokens: 7 } }, null, 2);
function credential(): IncumbentCredential {
  return { accessToken: "private-account-token", env: {
    [ENV.issuer]: "https://account-gateway.example", [ENV.privateJwk]: JSON.stringify(privateJwk),
    [ENV.scope]: "infer:balanced", [ENV.expiresAt]: String(now + 300_000),
    [ENV.tokenType]: "DPoP", [ENV.maxCostMicrousd]: "100000",
  } };
}
function fixture(saved = credential()) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    options: {
      routeModel: "balanced", now: () => now, loadCredential: () => saved,
      fetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(raw); },
    },
  };
}

describe("incumbent Not Organic dispatcher", () => {
  test("signs only the configured Responses URL, routes balanced, and preserves raw verified response", async () => {
    const { calls, options } = fixture();
    expect(await dispatchIncumbentNotOrganic(JSON.stringify(request), options)).toBe(raw);
    const call = calls[0]!;
    expect(call.url).toBe("https://account-gateway.example/v1/responses");
    expect(call.init.redirect).toBe("error");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(String(call.init.body))).toEqual({ ...request, model: "balanced" });
    expect(request.model).toBe("gpt-incumbent-concrete");
    const headers = new Headers(call.init.headers);
    expect(headers.get("authorization")).toBe("DPoP private-account-token");
    expect(headers.get("x-notorganic-max-cost-microusd")).toBe("100000");
    const proof = headers.get("dpop")!;
    const [header, body, signature] = proof.split(".");
    const payload = JSON.parse(Buffer.from(body!, "base64url").toString());
    expect(payload).toMatchObject({ htm: "POST", htu: call.url, iat: now / 1000 });
    expect(payload.ath).toBe(Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("private-account-token"))).toString("base64url"));
    expect(await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.publicKey, Buffer.from(signature!, "base64url"), new TextEncoder().encode(`${header}.${body}`))).toBe(true);
    expect(JSON.parse(Buffer.from(header!, "base64url").toString()).jwk.d).toBeUndefined();
  });

  test("accepts the optional judgement grant and uses a fresh proof and settlement key each call", async () => {
    const saved = credential(); saved.env[ENV.scope] = "infer:balanced judgement:evaluate";
    const { calls, options } = fixture(saved);
    await dispatchIncumbentNotOrganic(JSON.stringify(request), options);
    await dispatchIncumbentNotOrganic(JSON.stringify(request), options);
    for (const name of ["dpop", "idempotency-key"]) expect(new Headers(calls[0]!.init.headers).get(name)).not.toBe(new Headers(calls[1]!.init.headers).get(name));
  });

  test("requires explicit balanced routing before accessing credentials", async () => {
    for (const routeModel of [undefined, "gpt-incumbent-concrete", "fast"]) {
      await expect(dispatchIncumbentNotOrganic(JSON.stringify(request), { routeModel, loadCredential: () => { throw new Error("must not load"); } }))
        .rejects.toThrow("notorganic-incumbent-route-model-required");
    }
  });

  for (const [key, value] of [
    [ENV.scope, "judgement:evaluate"], [ENV.scope, "infer:balanced raw-model"], [ENV.expiresAt, String(now)],
    [ENV.expiresAt, "NaN"], [ENV.tokenType, "Bearer"], [ENV.maxCostMicrousd, "-1"],
    [ENV.maxCostMicrousd, "1.5"], [ENV.privateJwk, "private-invalid-key"],
    [ENV.issuer, "https://other.example/path"], [ENV.issuer, "http://nonlocal.example"], [ENV.issuer, ""],
  ]) {
    test(`rejects invalid stored capability ${key}=${value} before network`, async () => {
      const saved = credential(); saved.env[key!] = value;
      const { calls, options } = fixture(saved);
      await expect(dispatchIncumbentNotOrganic(JSON.stringify(request), options)).rejects.toThrow("notorganic-incumbent-capability-unavailable");
      expect(calls).toHaveLength(0);
    });
  }

  test("rejects invalid, streaming, alias, or oversized request before spending", async () => {
    const { calls, options } = fixture();
    for (const text of ["invalid private input", "[]", JSON.stringify({ ...request, model: "balanced" }), JSON.stringify({ ...request, model: "gpt-latest" }), JSON.stringify({ ...request, stream: true }), JSON.stringify({ ...request, input: 1 }), "x".repeat(MAX_INPUT_BYTES + 1)]) {
      await expect(dispatchIncumbentNotOrganic(text, options)).rejects.toThrow("notorganic-incumbent-invalid-request");
    }
    expect(calls).toHaveLength(0);
  });

  test("never labels missing, alias or different response models as the incumbent", async () => {
    const { options } = fixture();
    for (const model of [undefined, "balanced", "gpt-other", ` ${request.model}`]) {
      await expect(dispatchIncumbentNotOrganic(JSON.stringify(request), { ...options, fetch: async () => Response.json({ ...JSON.parse(raw), model }) }))
        .rejects.toThrow("notorganic-incumbent-model-mismatch");
    }
  });

  test("rejects incomplete and invalid successful response bodies", async () => {
    const { options } = fixture();
    for (const body of ["not json private response", JSON.stringify({ model: request.model, status: "incomplete", output: [] }), "x".repeat(4_000_001)]) {
      await expect(dispatchIncumbentNotOrganic(JSON.stringify(request), { ...options, fetch: async () => new Response(body) })).rejects.toThrow("notorganic-incumbent-invalid-response");
    }
  });

  test("sanitizes HTTP and thrown network failures without echoing request, token or upstream", async () => {
    const { options } = fixture();
    for (const fetcher of [async () => new Response("private upstream secret", { status: 403 }), async () => { throw new Error("private token and prompt"); }, async () => new Response(null, { status: 307, headers: { location: "https://attacker.example" } })]) {
      await expect(dispatchIncumbentNotOrganic(JSON.stringify(request), { ...options, fetch: fetcher })).rejects.toThrow(/^notorganic-incumbent-request-failed$/);
    }
  });

  test("bounds both connection and body-read time", async () => {
    const { options } = fixture();
    for (const fetcher of [() => new Promise<Response>(() => {}), async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}) }))]) {
      await expect(dispatchIncumbentNotOrganic(JSON.stringify(request), { ...options, fetch: fetcher, timeoutMs: 10 })).rejects.toThrow("notorganic-incumbent-timeout");
    }
  });

  test("CLI failure emits only a stable stderr code and no stdout", async () => {
    const child = Bun.spawn([process.execPath, new URL("./incumbent_notorganic_dispatch.ts", import.meta.url).pathname, "--route-model", "balanced"], { stdin: new Blob(["private malformed learner input"]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit).toBe(1); expect(stdout).toBe(""); expect(stderr).toBe("notorganic-incumbent-invalid-request\n");
  });
});
