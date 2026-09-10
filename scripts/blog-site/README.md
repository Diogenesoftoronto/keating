# Keating blog

Standalone `blog.keating.help` service. Bun serves current Standard.site records;
the repository's `web/server/utils/atproto-blog.ts` and
`web/src/keating/standard-site.ts` remain the only source resolver/parser.
No posts, publication IDs, passwords, or fallback archives are bundled.

The server renders article bodies, GFM tables, math, index filters, and discovery
metadata without browser JavaScript. The small browser script remembers the
reader's color theme. Existing Keating colors, logo, JetBrains Mono/VT323, row
layout, and serif article reading surface are retained. The full app's runnable
code and interactive Mermaid renderer are not included; code fences remain
readable code. No application navigation, authentication, or provider runtime is
needed by this service.

## Build and run

From this directory:

```sh
rtk bun install --frozen-lockfile
rtk bun run test
rtk bun run build
rtk bun smoke-isolated.ts
rtk bun run start
```

From the repository root, run `rtk devenv tasks run keating:blog-site-build`;
its dependency task installs the standalone dependencies. The underlying command
is `rtk bun scripts/blog-site/build.ts`. It bundles the shared source and renderer dependencies into
`dist/server.js`, and copies the actual brand assets, licensed fonts, KaTeX
styles/fonts, and deployment files into ignored `dist/`.

**The Railway service root/upload is `scripts/blog-site/dist`, not the source
directory.** The artifact has no imports outside itself and no runtime package
dependencies. Rebuild before every upload. Use its `railway.toml` and
`railpack.json`. Native Railpack uses Bun 1.3.13 at runtime; unlike the static
docs/dev sites, blog requests need a server to fetch current AT records.

```sh
rtk proxy railpack prepare scripts/blog-site/dist --plan-out /tmp/keating-blog-plan.json
```

`PORT` is honored (local default
4192; Railway may use 8080). `/healthz` checks process liveness independently of
the PDS; verify `/api/blog`, discovery, and an article separately after deploy.
The shared reader retains its 60-second feed cache and eight-second per-fetch
timeout. Concurrent requests share an in-flight read.

Upload command, after building and reviewing the artifact:

```sh
rtk railway up scripts/blog-site/dist --path-as-root --service keating-blog --environment production
```

## Public source configuration

Set the actual `KEATING_BLOG_ATPROTO_REPO` handle/DID and preferably the durable
`KEATING_BLOG_PUBLICATION_URI` of the existing publication. No account password
or token is required for public reads. Optional existing reader settings:

- `KEATING_BLOG_CANONICAL_URL`: publication lookup hint (default
  `https://keating.help`); this does not rewrite the record's URL.
- `KEATING_BLOG_PDS_URL`: only for an intentional PDS override; otherwise follow
  the DID document so account migration keeps working.
- `KEATING_BLOG_HANDLE_RESOLVER`, `KEATING_BLOG_PLC_DIRECTORY`: optional resolver
  overrides, with the same HTTPS validation as the main application.

On 2026-09-10, the dedicated `blog.keating.help` account was created on
`https://pds.notorganic.info` and 46 historical posts were published. The live
reader uses DID `did:plc:tiyely2inmhsmp6g6gmqsgm3` and publication URI
`at://did:plc:tiyely2inmhsmp6g6gmqsgm3/site.standard.publication/self`.
Its canonical URL is `https://blog.keating.help`. The public feed and discovery
endpoint were verified. See [publisher setup](../../docs/STANDARD_SITE_BLOG.md)
for public identity and credential key names. An unavailable source returns 503.

## Routing and publication move

| URL | Response |
| --- | --- |
| `/` | Server-rendered blog index with `q` and `tag` filters |
| `/blog`, `/blog/` | 308 to `/`, preserving the query |
| `/blog/<slug>` | Article and document backlink, or real 404 |
| `/api/blog` | Current shared-reader feed JSON |
| `/.well-known/site.standard.publication` | Exact publication AT-URI, plaintext |
| `/sitemap.xml` | All canonical documents on this host |
| `/robots.txt` | Crawl permission and sitemap location |
| `/healthz` | Process health (does not prove PDS readiness) |

Keep `/blog/<slug>` because existing document records use that path. The
application redirects old `keating.help/blog` to the new root and old article
paths to the same `/blog/<slug>` on the new host. Preserve query strings and keep
the old publication well-known route resolving to the same AT-URI during the
transition. Root-relative content images/assets and app links continue pointing
to `keating.help`; article links remain on the blog site.

An external update of the existing publication record's `url` to
`https://blog.keating.help` is required to make this host canonical. Keep the
publication AT-URI, document `site` references, and document paths unchanged.
Until that update, HTML canonicals deliberately follow the old record's URL and
the new host's sitemap omits those foreign canonical URLs. Serving the discovery
endpoint on a mirror does not establish a bidirectional domain proof by itself.
No build, server, or test in this directory writes AT Protocol records.

References: [Standard.site verification and URL definitions](https://standard.site/#verification),
[Railpack Bun](https://railpack.com/languages/bun/).
