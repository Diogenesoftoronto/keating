# Publishing a blog post to Keating

Keating reads blog posts from your AT Protocol repository. There is no Keating
blog publishing UI yet: publish by writing Standard.site records to your PDS.

## One-time publication record

Create a `site.standard.publication` record and keep its returned `at://` URI.

```json
{
  "$type": "site.standard.publication",
  "url": "https://keating.education",
  "name": "Keating",
  "description": "Optional publication description"
}
```

## Each blog post

Write a `site.standard.document` record. Set `site` to the publication URI,
choose a stable `/blog/<slug>` path, and place the post body in Markpub
Markdown.

```json
{
  "$type": "site.standard.document",
  "site": "at://did:plc:YOUR_DID/site.standard.publication/keating",
  "title": "My post",
  "publishedAt": "2026-08-15T16:00:00.000Z",
  "updatedAt": "2026-08-15T16:00:00.000Z",
  "path": "/blog/my-post",
  "description": "Short summary",
  "tags": ["learning", "ai"],
  "content": {
    "$type": "at.markpub.markdown",
    "text": { "markdown": "# My post\n\nBody in Markdown." }
  }
}
```

Use an authenticated `com.atproto.repo.putRecord` call against your PDS. Prefer
OAuth; an app password is acceptable for a personal publishing script. Updating
the same record updates the post.

## Keating configuration

```sh
KEATING_BLOG_ATPROTO_REPO=your.handle
KEATING_BLOG_PUBLICATION_URI=at://did:plc:YOUR_DID/site.standard.publication/keating
KEATING_BLOG_CANONICAL_URL=https://keating.education
```

`KEATING_BLOG_PDS_URL` is optional: Keating otherwise resolves the PDS from the
account DID document.
