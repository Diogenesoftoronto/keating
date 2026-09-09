# Keating developer handbook

Public developer documentation for `dev.keating.help`. Content lives in
`content/*.json`; `build.ts` generates the pages, navigation, search index, and
sitemap in ignored `public/`.

## Local development

From the repository root:

```sh
rtk devenv up caddy
```

Devenv's native `services.caddy` serves <http://localhost:4190>. Its startup
dependency runs `keating:dev-site-build` first. After editing content or assets:

```sh
rtk devenv tasks run keating:dev-site-build
```

## Railway / Railpack

Use `scripts/dev-site` as the service root and its `railway.toml` as the Railway
configuration. Railpack's native Staticfile provider generates and manages the
production Caddy server. No Dockerfile or custom server process is required.
`railpack.json` adds Bun for the build only and preserves Railpack's generated
server setup. `Staticfile` selects `public` and disables SPA fallback so missing
documentation returns HTTP 404.

Validate the plan from the repository root:

```sh
rtk proxy railpack prepare scripts/dev-site --plan-out /tmp/keating-dev-plan.json
```

Deploy this directory as an isolated upload to the developer service:

```sh
rtk railway up scripts/dev-site --path-as-root --service keating-developer --environment production
```

Keep the Bun package version and absolute build executable path in
`railpack.json` synchronized when upgrading. Railway provides `PORT`; the health
check requests `/` so it verifies the generated homepage is available.

References: [Devenv Caddy service](https://devenv.sh/services/caddy/),
[Railpack static sites](https://railpack.com/languages/staticfile/), and
[Railpack configuration](https://railpack.com/config/file/).
