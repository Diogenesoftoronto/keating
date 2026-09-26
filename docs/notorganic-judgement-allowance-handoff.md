# Lifetime free allowance for judgement calls

Requested account policy: **5,000 microUSD ($0.005) total per account**, restricted to judgement calls. This is a lifetime allowance, shared across sessions, devices, and products. It is not a per-call allowance, a recurring grant, or a request-count entitlement. The user clarified the account-wide scope, then increased the amount from 50 to 5,000 microUSD, and authorized this handoff to Not Organic.

Keating is moving teaching rules into granular TypeSafe/Jev judgments. A turn can involve a batched input decision, private draft reviews, and selection among passing drafts. Failed drafts stay private; only approved content is published. The account service owns the subsidy and its accounting. Keating must not mint credits or hold provider credentials in the browser.

## Required behavior

- Grant each account DID exactly 5,000 integer microUSD of judgement-only lifetime allowance, including existing accounts on first eligible use. Authenticate account identity through the existing boundary.
- Apply the allowance to actual billable judgement usage. Continue ordinary paid funding after it is exhausted; expose the two funding sources separately in receipts and wallet responses.
- Reserve, settle, and release the subsidy atomically. Across concurrent requests, devices, and products, consumed allowance plus active reservations must never exceed 5,000 microUSD.
- Replayed settled idempotent requests consume no additional allowance. Keep the existing DID + NUL + idempotency-key identity and request-hash/model/product checks.
- Return unused reserved allowance on normal settlement or a known non-billable failure. Preserve conservative accounting for ambiguous delivery/usage, and integrate expiry/reconciliation.
- Do not reset the allowance on sign-in, logout, product installation, or a new session. Ordinary chat, image, and other non-judgement usage must not consume it or use it to repay unrelated debt.
- Report granted, consumed, reserved, and remaining judgement microUSD explicitly. Do not promise a fixed number of requests: request cost depends on usage.

## Existing seams and constraints

- `apps/gateway/src/judgement.ts` / `JudgementGateway.evaluate` already tags the feature as `judgement`, but uses a **50 microUSD minimum reservation**. Once only 45 microUSD of allowance remain, another small eligible request must still be able to use that remainder. Address the estimate and free/paid reservation split explicitly.
- `convex/inference.ts` (`begin`, `complete`, `fail`) and `convex/wallet.ts` (`reserveFunds`, `settleFunds`, `releaseFunds`) are the transactional accounting boundary. Add a DID-keyed lifetime judgement allowance, or fully propagate explicit feature scoping through grants and reservation allocations.
- `convex/schema.ts` currently gives grant lots a product scope, not a feature scope. An ordinary unrestricted grant would let unrelated requests consume this allowance. `issueGrantFunds` also pays generic account debt first; avoid that behavior for this subsidy.
- `convex/maintenance.ts` handles expiry. `apps/gateway/src/convex-store.ts` preserves settlement/reconciliation and encrypted response replay. `convex/gateway.ts` exposes wallet data.
- Preserve the existing **2,500,000 microUSD Keating welcome credit**; this request neither replaces nor increases that separate credit.

## Acceptance checks

Verify first use and existing accounts, two concurrent requests, cross-device/product reuse of the same account, duplicate request replay, changed payload under a reused key, partial settlement, timeout/reconciliation, allowance exhaustion with and without paid funds, sub-50 remainder use, and non-judgement requests. Assert integer units and the invariant `consumed + reserved <= 5000`. Ensure no path credits unrelated debt or grants a second allowance.

Implementation patterns: `apps/gateway/src/judgement.test.ts` and `tests/welcome-grants.test.ts`. This handoff requests implementation; it does not assert that the allowance has shipped or is active.

## Delivery receipt

Created issue `ac0c4af8f7e75235f012238f74b901fed261ef06` in private Radicle repository `rad:z498dJmE57PoHdY7p1tEX2CDEKUq3` on 2026-09-21. Radicle returned success and an open issue, followed by “No seeds found”; peer replication/delivery is unconfirmed.
