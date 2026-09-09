# Web asset delivery

The web app uses AVIF variants for runtime artwork and screenshots. Original
PNGs remain available as source artwork and for platform icons.

Regenerate the 53 selected assets with
`rtk proxy python3 web/scripts/optimize-runtime-images.py` (ImageMagick/AVIF).
The manifest and byte/pixel report live beside that script. Artwork uses quality
75 and tutorial screenshots quality 80, both with full chroma resolution. The
script verifies dimensions and limits normalized RGBA RMSE to 1% and alpha RMSE
to 0.5%; these are lossy variants. Representative sprites and screenshot text
were also inspected visually. The compact logo remains lossless after resizing
from 3344×1880 to 228×128 for its largest 64px-high display at 2× density.
PNG platform and OpenGraph icons are retained. The 53 optimized assets total
3,986,844 bytes: 57.8% smaller than the first AVIF pass (9,436,837 bytes), and
74.4% smaller than the original PNGs (15,603,967 bytes).

Cache policy lives in `web/nitro.config.ts`:

- `/assets/**` contains Vite content hashes: public, one year, immutable.
- Public image directories and exact root asset filenames: public, one day.
  This includes AVIF, WebP, JPEG, and PNG within those directories.
- HTML, chat, sign-in callbacks, and APIs: no-store.
- `/sw.js` and its imported `/__sw__.js`: revalidate on every fetch.

Do not use `/**/*.png` or `/*.png` as Nitro route rules. The installed rou3
matcher treats these as wildcards without enforcing the extension. The cache
regression test exercises the actual matcher so page routes cannot accidentally
inherit image caching again.

The PWA precaches application code and install icons. Other images enter a
bounded same-origin cache only when requested, avoiding downloads of posters,
tutorials, and source artwork during a first visit to chat. Unversioned images
use stale-while-revalidate in the worker; hashed bundles use cache-first.

## Railway CDN

Railway CDN caching is a service setting in addition to origin headers:
https://docs.railway.com/networking/cdn

After selecting the production project/environment and confirming the linked
web service, use these commands (replace `WEB_SERVICE` with its actual name):

```sh
rtk railway cdn status --service WEB_SERVICE
rtk railway cdn update --service WEB_SERVICE --html-caching never --purge-on-deploy all
rtk railway cdn enable --service WEB_SERVICE
rtk railway cdn purge all --service WEB_SERVICE
```

Deploy the corrected origin cache rules before enabling the CDN. Purging all on
deploy refreshes the unversioned public images as well as HTML. Content-hashed
assets remain reusable in browser caches. Do not force-cache HTML or API routes.

Verify the live response, not just the setting: request an image twice and check
`x-cache`/`age`; confirm `/chat` and callbacks still return `text/html` with
`Cache-Control: no-store`, APIs remain uncached, and missing assets return 404.
`/.railway/cdn-trace?json` identifies an active Railway CDN edge.

The CDN setting has not been changed or verified during this local patch: the
Railway management API was unreachable from the execution environment.
