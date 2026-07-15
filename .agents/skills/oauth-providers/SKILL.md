---
name: oauth-providers
description: >-
  Debug OAuth sign-in failures and add new OAuth providers to Keating (web +
  CLI). Use when a provider's "Sign in with …" flow fails, when adding a new
  OAuth provider, or when changing redirect URIs, token exchange, or refresh
  behavior.
---

# OAuth providers in Keating

How OAuth sign-in works in this repo, the provider-specific quirks that have
already caused bugs, and the checklist for adding a new provider.

## Architecture

The web app uses an authorization-code + PKCE flow, brokered through the
Nitro server so tokens are exchanged server-side:

| Piece | File | Role |
|---|---|---|
| Provider registry | `web/src/keating/oauth.ts` (`OAUTH_PROVIDERS`) | Client IDs, authorize/token URLs, scopes, redirect URIs, extra authorize params |
| Redirect resolution | `web/src/keating/oauth.ts` (`resolveOAuthRedirectUri`) | Prod (`keating.help`) → `https://keating.help/oauth/callback`; everywhere else → the provider's CLI loopback URI + manual paste |
| Popup + pending state | `web/src/keating/oauth.ts` (`initiateOAuth`) | Saves `{verifier, state, redirectUri}` to localStorage under `keating_oauth_pending`, opens the authorize popup |
| Callback page | `web/src/pages/OAuthCallback.tsx` (route `/oauth/callback`) | Runs `completeOAuthFromInput(location.href)`, posts `keating-oauth-result` message to the opener |
| Manual paste input | `web/src/components/settings/CloudProviderKeysSection.tsx` | Shown while sign-in is pending; accepts a pasted callback URL, `code#state`, query string, or bare code |
| Token exchange | `web/server/api/oauth/token.ts` | POSTs to the provider's token URL with the stored verifier |
| Token refresh | `web/server/api/oauth/refresh.ts` | Auto-refresh 60s before expiry; 401/403 deletes stored credentials |
| Server client config | `web/server/api/oauth/config.ts` | Client IDs/secrets, env-overridable (`OAUTH_<PROVIDER>_CLIENT_ID` / `_SECRET`) |
| Consumption | `web/src/lib/provider-models.ts` (`getProviderApiKey`) | OAuth token (or exchanged API key) wins over stored API keys |
| Reference implementation | `web/node_modules/@earendil-works/pi-ai/dist/utils/oauth/*.js` | The CLI's working flows — **check here first when a web flow misbehaves** |

Credentials are stored per provider as JSON under the `oauth:<id>` key in
`getAppStorage().providerKeys`. Provider-name aliasing (`openai` →
`openai-codex`, `google` → `google-gemini-cli`) lives in `providerToOAuthId`.

After editing `web/src/keating/oauth.ts`, regenerate the sandbox snapshot:
`bun scripts/generate-nodepod-boot-files.ts`.

## Provider quirks (hard-won; do not regress)

**Anthropic** (client `9d1c250a-e61b-44d9-88ed-5944d1962f5e`, Codex Pro/Max):
- The token endpoint `https://platform.Codex.com/v1/oauth/token` only accepts
  **JSON bodies** (`Content-Type: application/json`), for both code exchange
  and refresh. Form-urlencoded fails. This is special-cased in `token.ts` and
  `refresh.ts`.
- Uses the provider-hosted code-display callback
  (`https://platform.Codex.com/oauth/code/callback`) in **all** environments;
  the user copies a `code#state` string. `code=true` must be in the authorize
  params or the code is never displayed.
- `state` must equal the PKCE **verifier** (not a random value), and must be
  sent in the token exchange body.
- Resulting `sk-ant-oat-*` access tokens are handled downstream by pi-ai
  (Bearer + `anthropic-beta: oauth-2025-04-20` headers) — pass them through as
  the "apiKey"; do not put them in `x-api-key` yourself.

**OpenAI Codex** (client `app_EMoamEEZ73f0CkXaXp7hrann`, ChatGPT Plus/Pro):
- Only `http://localhost:1455/auth/callback` is registered; any web-origin
  redirect is rejected at the authorize step (unless keating.help is registered
  on the client used — see redirect resolution above).
- Form-urlencoded token exchange is correct here.
- After exchange, the `id_token` is swapped for a real OpenAI API key via a
  token-exchange grant (`web/server/api/oauth/openai-codex.ts`,
  `requested_token: openai-api-key`).
- Authorize needs `id_token_add_organizations=true`,
  `codex_cli_simplified_flow=true`, `originator`.

**Google Gemini CLI** (client `681255809395-oo8f…`, installed app):
- Installed-app clients accept **any localhost port** as redirect but **no
  https origins**, and the token exchange **requires the client secret** —
  the Gemini CLI's secret is public by design (embedded in its open-source
  repo; Google docs say installed-app secrets are not confidential) and is the
  fallback in `web/server/api/oauth/config.ts`.
- Authorize needs `access_type=offline&prompt=consent` or no refresh token is
  returned.

## Debugging a failing sign-in

1. Reproduce and note **which step** fails:
   - Error on the provider's authorize page → redirect URI not registered for
     that client, or missing required authorize params.
   - "Token exchange failed: 502 …" from the app → server-side exchange
     rejected; check the Nitro log line `[oauth/token] <provider> token
     exchange failed: <status> <body>` for the upstream error.
   - Signed in but requests 401 → token consumed incorrectly (see quirks), or
     refresh failing (`[oauth/refresh]` log).
2. Diff the failing flow against the CLI's pi-ai implementation
   (`node_modules/@earendil-works/pi-ai/dist/utils/oauth/`) — encoding (JSON
   vs form), authorize params, state semantics, redirect URI. Every web bug so
   far has been a divergence from those reference flows.
3. Fix in the smallest layer (registry vs server handler), then run
   `cd web && bun test src/test/oauth.test.ts && bunx tsc --noEmit`.

## Adding a new provider

1. Add the entry to `OAUTH_PROVIDERS` in `web/src/keating/oauth.ts` (extend
   `OAuthProviderId`). Set `redirectUri` if the client only accepts a fixed
   loopback URI; leave it unset to use the web callback.
2. Add server client config in `web/server/api/oauth/config.ts` (extend
   `OAuthServerProviderId`), with env overrides. Note the token body encoding
   the provider expects — special-case in `token.ts`/`refresh.ts` if not
   form-urlencoded.
3. Map the app-facing provider name in `providerToOAuthId` and
   `oauthProviderToProviderNames` (CloudProviderKeysSection), and add a label
   to `OAUTH_PROVIDER_LABELS`.
4. Wire consumption: confirm `getProviderApiKey` returns something the model
   client can use; if the provider needs a secondary exchange (like Codex →
   API key), do it server-side after the token response.
5. Tests in `web/src/test/oauth.test.ts`: provider wiring, redirect URI
   resolution (prod + dev), and any exchange encoding special case.
6. Regenerate nodepod boot files; run `cd web && bun test && bunx tsc --noEmit`.
