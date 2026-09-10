# Standard.site Blog on the Keating PDS

Keating's standalone public blog at `https://blog.keating.help` is read from `site.standard.publication` and
`site.standard.document` records in one AT Protocol repository. The web server
accepts the configured DID (or resolves a handle), follows the DID document to the
account's current PDS, and reads the records there. Moving the account to a
Tranquil PDS therefore does not change article URLs or require a client rebuild.

## Record shape

- Publication: `site.standard.publication`, record key `self`, canonical URL
  `https://blog.keating.help`.
- Documents: `site.standard.document`, with stable slug record keys and paths at
  `/blog/<slug>`.
- Rich body: `at.markpub.markdown` using GFM.
- Portable fallback: `textContent` contains a formatting-free representation.

Article HTML includes `<link rel="site.standard.document" href="at://...">`.
The publication is verified at:

```text
https://blog.keating.help/.well-known/site.standard.publication
```

## Prepare the historical posts

The publisher is dry-run by default. It renders the retired JSX archive to GFM
and writes the exact publication/document payloads under `.keating/outputs/`:

```bash
rtk proxy env KEATING_BLOG_DID=did:plc:tiyely2inmhsmp6g6gmqsgm3 bun scripts/publish-standard-site-blog.ts
```

Run from `web/`. `KEATING_BLOG_DID` is public and selects the dry-run identity;
without it, dry-run records contain a placeholder DID. Inspect
`.keating/outputs/standard-site-blog.json` before writing anything to a
PDS. To prepare or publish one post, pass its generated record key:

```bash
bun scripts/publish-standard-site-blog.ts --only=v2-10-0-example
```

## Publisher account

The dedicated account was created on `https://pds.notorganic.info` on 2026-09-10:

- Handle: `blog.keating.help`.
- DID: `did:plc:tiyely2inmhsmp6g6gmqsgm3`.
- DNS proof: `_atproto.blog.keating.help` TXT
  `did=did:plc:tiyely2inmhsmp6g6gmqsgm3`.
- Publication: `at://did:plc:tiyely2inmhsmp6g6gmqsgm3/site.standard.publication/self`.

The account credential is stored under the Skate key
`keating-blog-account@secrets`; its dedicated publisher app password is under
`keating-blog-app-password@secrets`. These are key names, not credentials. Keep
values outside the repository, shell history, logs, and public reader service.
Capture secret-store output in memory; raw secret listings print values.

Have the secret store inject these variables into the publisher subprocess:

```text
KEATING_BLOG_PDS_URL
KEATING_BLOG_IDENTIFIER
KEATING_BLOG_APP_PASSWORD
```

Then publish without placing the password in the command:

```bash
cd web
bun scripts/publish-standard-site-blog.ts --write
```

`--write` uses `com.atproto.server.createSession`, then upserts records with
`com.atproto.repo.putRecord`. Stable record keys make repeat runs idempotent.
The script prints the durable publication AT-URI after a successful run.

## Runtime configuration

The standalone blog deployment uses this public configuration:

```text
KEATING_BLOG_ATPROTO_REPO=did:plc:tiyely2inmhsmp6g6gmqsgm3
KEATING_BLOG_PUBLICATION_URI=at://did:plc:tiyely2inmhsmp6g6gmqsgm3/site.standard.publication/self
KEATING_BLOG_CANONICAL_URL=https://blog.keating.help
```

`KEATING_BLOG_ATPROTO_REPO` may be the handle or DID. Production uses the DID to
avoid handle-resolver cache delays. The custom handle was verified separately
through DNS and the PDS; records and verification use the durable DID-based URI.

Optional settings:

```text
KEATING_BLOG_PDS_URL=https://pds.example
KEATING_BLOG_HANDLE_RESOLVER=https://public.api.bsky.app
KEATING_BLOG_PLC_DIRECTORY=https://plc.directory
```

`KEATING_BLOG_PDS_URL` is a deployment override for local or staged Tranquil
instances. In normal production use, omit it so Keating follows the PDS endpoint
in the DID document and survives account migration automatically.

No PDS access token or app password is sent to the browser. Blog reads use the
public repository APIs through the blog site's same-origin `/api/blog` route.

## Standalone service and URL migration

The source is `scripts/blog-site/`; its build bundles the existing web blog reader
and parser into a self-contained Bun service in `scripts/blog-site/dist/`. See
[standalone blog deployment](../scripts/blog-site/README.md) for build, runtime,
and Railway upload instructions. `/healthz` proves process health; `/api/blog`,
the discovery endpoint, and a rendered article must be verified separately.

The index is `/`; `/blog` redirects there. Articles keep `/blog/<slug>` so their
Standard.site document paths do not need rewriting. Redirect old
`https://keating.help/blog/<slug>` URLs to the same path on `blog.keating.help`.
Keep the old publication discovery endpoint resolving to the same AT-URI while
transitioning hosts.

For an existing publication, update its `url` to `https://blog.keating.help`
without changing its AT-URI, document `site` references, or document paths.
The standalone renderer derives canonical document URLs from the publication
record URL plus each document path. A deployment environment setting alone does
not update the external record or complete the domain proof.

The publisher defaults to `https://blog.keating.help` for new publication records
and remains dry-run by default. On 2026-09-10, the dedicated account received 47
records: one publication and 46 historical documents. The live blog feed returned
all 46 posts and the discovery endpoint returned the exact publication AT-URI.
The service returns 503 when its public source is unavailable. Process health,
account email verification, and article delivery are separate checks.
