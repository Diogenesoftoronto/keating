# Runtime configuration

`packages/runtime-config` owns mutable **public** model and service defaults. It
exports TypeScript source with no build step, filesystem access, environment
reads, credentials, or application imports. Platform adapters read environment
variables and persisted settings and supply overrides at their existing boundaries.

| Value | Canonical module |
| --- | --- |
| Role defaults, ordered setup/live choices, speech/image/judgement choices, discovery preferences | `packages/runtime-config/src/models.ts` |
| Public service origins, provider endpoints, API versions | `packages/runtime-config/src/services.ts` |
| Not Organic model consent and explicit capability scopes | `packages/runtime-config/src/oauth.ts` |
| Public reservation ceilings in micro-USD | `packages/runtime-config/src/budgets.ts` |

The package index re-exports those modules. CLI/core code and learner contracts
use relative `.js` imports, as the TUI's learner-contracts bridge does. Root
TypeScript includes the sources, emitting them under `dist/packages/runtime-config`;
the npm `files` entry for `dist/` includes them without publishing a private
workspace dependency. Web uses `file:../packages/runtime-config`. Mobile uses
`workspace:*`; the existing Metro resolver handles source `.js` specifiers.
No new Metro configuration or separate package build is needed.

## Changing a default

Add an ID once to the private `packages/runtime-config/src/model-identities.ts` registry, then point the
appropriate `DEFAULT_MODELS` role at it. Consumers import role defaults and
`MODEL_CHOICES`, `LIVE_MODEL_CHOICES`, `MODEL_PREFERENCES`, `IMAGE_MODEL_IDS`, or
the Not Organic model lists. The value-named `MODEL_IDS` namespace is private;
its only public representation is the `RuntimeModelId` union type.

Keep intentional platform differences: CLI OpenAI currently selects GPT-5.5,
while mobile selects GPT-5.4. The setup and live lists put their role default
first, and mobile fallback IDs,
keys and display names follow `DEFAULT_MODELS.mobile`. Setup labels and default
live labels are resolved centrally from the selected role ID. Change curated
preferences and alternative choices in this same module; provider discovery
still owns current availability, pricing,
capabilities and other metadata. Updating an ID does not establish availability
for a particular provider account. The Google speech-provider descriptor retains
its shipped legacy-first display order; live recommendations and session defaults
use the separate live role, preserving that intentional surface distinction.

Precedence is explicit request selection, then persisted settings, then the
platform's supported deployment environment override, then the canonical default.
Only adapters that already expose a deployment override read one; adding an ID
does not introduce a new environment variable. Empty optional scope overrides
mean “derive the default.” Existing validation for issuer activation, HTTPS,
DPoP, PKCE and cost ceilings still applies. Server authorization and enforced
ceilings constrain requests regardless of client configuration.

The checked-in `keating.config.json` deliberately selects Not Organic `balanced`
and embedded runtime mode. Its copied speech model now inherits the same
canonical default. `chrysalis.config.json` deliberately pins GPT-5.4; it is an
explicit project override and is not silently upgraded to the CLI default.

## Adding a Not Organic model

1. Define the ID in the private model registry and add it to `NOTORGANIC_CHAT_MODEL_IDS` or
   `NOTORGANIC_IMAGE_MODEL_IDS`.
2. Add the corresponding metadata entry to the Not Organic adapter's picker.
   The web configuration test checks that chat picker IDs equal the consent list.
3. Verify the provider's gateway route and obtain fresh user consent for the
   new `infer:<id>` permission. Updating a list does not expand an existing grant.

`buildNotOrganicScope({ models, capabilities })` produces sorted, deduplicated
inference scopes plus explicitly requested capabilities. The default comes from
the chat/image lists and `NOTORGANIC_CAPABILITIES`. Capability placement preserves
the previously shipped browser scope string byte for byte. Judgement and tabular
permissions remain separate opt-ins. CLI and mobile retain their narrower grants;
they do not inherit the browser's broader consent list.

`VITE_NOTORGANIC_SCOPE` is optional. Absent, blank or whitespace-only values use
the derived scope. A non-empty value remains a restrictive explicit override
(after trimming); it is not unioned with defaults. Existing connections need to
reconnect to approve a missing model permission.

The former code fallback included `infer:image`, but Devenv and `.env.example`
overrode it with a handwritten scope that omitted image consent. This migration
keeps the **code default**, including `infer:image`, and makes both environment
values empty. This deliberately repairs that environment discrepancy; all model
IDs, URLs, request headers and numeric defaults retain their previous values.

Browser, CLI and mobile account requests retain the 100000 micro-USD reservation
ceiling ($0.10); the server deployment ceiling remains 50000 ($0.05). These are
reservation ceilings, not prices. Pack/plan catalogs remain independently owned.

## Intentional pins and verification

Keep historical benchmarks/blog records, smoke/Storybook fixtures, frozen local
model revisions and hashes, experiment identities/caps, and protocol/schema
versions pinned. In particular, changing a public default must not change a
calibration identity, offline download revision, Julia manifest, or Needle contract.
Exact file/literal exceptions in `test/config-hygiene.test.ts` document such pins
and UI/provider protocol names; active defaults must not be disguised as fixtures.

Run the runtime-config package test, relevant consumer tests and package
TypeScript checks. `bun scripts/check-env-docs.ts` checks the environment variable
contract shared by Devenv, `web/.env.example` and the Not Organic operations guide.
The guardrail scans non-test source literals and template segments, ignores
comments/module paths, and proves detection with a synthetic new model ID.
It also recognizes private registry IDs from providers outside its model-name patterns.

Scripts and research remain outside this runtime migration. Historical benchmark,
calibration, smoke, and frozen offline identities must retain their original IDs;
script defaults such as `scripts/context-window/providers.ts` need a separately
reviewed migration rather than silently inheriting a changing application role.
Pack/plan catalogs, protocol versions, experiment ledgers and artifact hashes keep
their existing authorities. The guardrail scans application/package source and
rejects value-named model references there, while documenting exact frozen data
and non-model UI/protocol strings as exceptions. Linking this guide from
`docs/agent-reference.md` and regenerating the NodePod bootstrap remain OPS work.
