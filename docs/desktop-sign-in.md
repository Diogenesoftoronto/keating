# Desktop sign-in

## Not Organic accounts

Not Organic approval opens in the system browser, then returns through the
desktop's temporary `http://127.0.0.1:53693/notorganic/callback` receiver.
The receiver binds only to loopback, checks the pending state, accepts one
approval or denial, and expires after ten minutes. If the port is occupied,
sign-in reports an error before opening the browser; retry after closing the
other attempt.

The app retains the PKCE transaction and non-extractable DPoP key in its own
renderer. The browser callback carries only the code and state back to the
app; it does not exchange or store the account token. The app completes the
exchange and returns to the originating chat or pricing page. Account access
is short-lived and requires reconnecting after expiry or an app restart.

The packaged renderer uses a different ephemeral loopback port. The gateway
must explicitly enable `CORS_ALLOW_LOOPBACK=true` for these HTTP loopback
origins. This permits CORS, not account access: PKCE, DPoP and capability checks
still apply. No cookie credentials or wildcard CORS origin are enabled.

## Model subscriptions

Claude and Codex open the system browser for approval. The desktop app starts
a temporary callback listener before opening the browser and completes the
token exchange when approval returns. The listener checks the pending state,
expires after ten minutes, and is cancelled when another sign-in starts.
Closing Settings does not stop the desktop callback handler.

Claude uses automatic return by default. If the return listener cannot start,
Keating offers retry or an explicit authorization-code alternative. Codex can
instead use a one-time device code when its callback port is unavailable.

In a regular browser, Claude approval ends on its provider-hosted code page.
Copy that authorization code, then use **Paste code** and **Complete** in Keating.
The clipboard is read only when you press **Paste code**; ordinary paste remains
available if the browser denies clipboard access. Keating cannot read Claude's
page across browser origins or start a local callback server from a website.
Automatic browser return would require a callback registered with the provider
for Keating. Changing the shared client's redirect URL is not sufficient.
Claude's own [authentication documentation](https://code.claude.com/docs/en/authentication)
describes the local callback and manual-code fallback.

## Credential storage

When the system keyring is available, provider keys and OAuth credentials are
encrypted in the desktop vault. When it is unavailable, new credentials stay
in the main process's memory until Keating quits. Settings shows this mode.
Closing and reopening a desktop window keeps that session alive; quitting
the app does not. Credentials move into the encrypted vault when the keyring
becomes available again.

Session-only storage never writes plaintext credentials to disk or P2P.
Existing encrypted and legacy credentials remain intact until a durable
replacement is saved. Corrupt files, failed decryption, and filesystem errors
remain errors rather than silently falling back. Sign-out deletes stored
credentials even when the keyring is locked.

## Development and updates

Restart the desktop app after changing its main process or preload code.
Restart an existing development process once after updating the dev runner:

```sh
devenv tasks run keating:web
```

The web runner now starts Nitro's development watcher alongside Vite. API
handler and configuration changes reload with Nitro. `bun run preview` in
`web/` serves the complete production build, including its API.

Missing API endpoints return JSON errors. An HTML response during sign-in
indicates an outdated or incomplete server; it does not contain a usable
authorization result.
