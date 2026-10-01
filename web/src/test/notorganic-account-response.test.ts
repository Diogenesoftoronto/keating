import { describe, expect, it } from "bun:test";
import { getNotOrganicAccount } from "../notorganic-provider";

const respond = (body: unknown): typeof fetch => Object.assign(async () => Response.json(body), { preconnect: fetch.preconnect });

describe("Not Organic account response", () => {
  it("reads the provider account envelope and preserves its public identity", async () => {
    const account = { _id: "account-row", did: "did:plc:learner", status: "active" };
    await expect(getNotOrganicAccount(respond({ account, products: [], subscriptions: [] })))
      .resolves.toEqual({ ...account, id: "account-row" });
  });

  it("continues to accept a flat product account", async () => {
    await expect(getNotOrganicAccount(respond({ id: "learner", did: "did:plc:learner" })))
      .resolves.toEqual({ id: "learner", did: "did:plc:learner" });
    await expect(getNotOrganicAccount(respond({ account: { did: "did:plc:learner" } })))
      .resolves.toEqual({ id: "did:plc:learner", did: "did:plc:learner" });
  });

  it("does not treat a missing or malformed account as a connected identity", async () => {
    for (const body of [null, {}, { account: null }, { account: {} }, { account: { id: 5 } }]) {
      await expect(getNotOrganicAccount(respond(body))).rejects.toThrow("could not be verified");
    }
  });
});
