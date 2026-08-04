# Standard.site Blog on the Keating PDS

Keating's public blog is read from `site.standard.publication` and
`site.standard.document` records in one AT Protocol repository. The web server
resolves the configured handle to its DID, follows the DID document to the
account's current PDS, and reads the records there. Moving the account to a
Tranquil PDS therefore does not change article URLs or require a client rebuild.

## Record shape

- Publication: `site.standard.publication`, record key `self`, canonical URL
  `https://keating.help`.
- Documents: `site.standard.document`, with stable slug record keys and paths at
  `/blog/<slug>`.
- Rich body: `at.markpub.markdown` using GFM.
- Portable fallback: `textContent` contains a formatting-free representation.

Article HTML includes `<link rel="site.standard.document" href="at://...">`.
The publication is verified at:

```text
https://keating.help/.well-known/site.standard.publication
```

## Prepare the historical posts

The publisher is dry-run by default. It renders the retired JSX archive to GFM
and writes the exact publication/document payloads under `.keating/outputs/`:

```bash
cd web
bun scripts/publish-standard-site-blog.ts
```

Inspect `.keating/outputs/standard-site-blog.json` before writing anything to a
PDS. To prepare or publish one post, pass its generated record key:

```bash
bun scripts/publish-standard-site-blog.ts --only=v2-10-0-example
```

## Publish to Tranquil

Create the Keating account and an app password on the Tranquil PDS. Keep the
password outside the repository and shell history. Have the deployment secret
store inject these three variables:

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

Configure the Nitro deployment with:

```text
KEATING_BLOG_ATPROTO_REPO=blog.keating.help
KEATING_BLOG_PUBLICATION_URI=at://did:plc:.../site.standard.publication/self
KEATING_BLOG_CANONICAL_URL=https://keating.help
```

`KEATING_BLOG_ATPROTO_REPO` may be the handle or DID. Prefer the handle so the
status UI remains readable; records and verification always use the durable
DID-based URI.

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
public repository APIs through Keating's same-origin `/api/blog` route.
