# Download-page phone screenshots

The `/download` showcase uses independent image files, with the phone hardware
and captions rendered in the page. Replace an image without rebuilding a collage.

| File | View |
| --- | --- |
| `learn.jpg` | A tutoring conversation |
| `practice.jpg` | A quiz with an answer selected |
| `review.jpg` | A flashcard ready for recall |

Capture a **390 × 844 CSS-pixel viewport**, or the same aspect ratio at higher
resolution. Save as JPEG, ideally below 180 KB per image. Keep the app navigation
and composer, exclude browser chrome, and hide development toolbars. Do not bake
phone frames or captions into the files. The page owns those treatments.

These images were captured on 2026-09-06 from the running web app's `/chat` route
at phone width, using a staged, fictional bread-science lesson. They use the real
conversation, quiz, and flashcard renderers. They are mobile **browser** views,
not photographs of a native release or evidence of an LLM-generated lesson.

To change filenames, captions, or alt text, edit `PHONE_SHOTS` in
`web/src/pages/Download.tsx`. Use versioned filenames for a CDN-cached deployment
and update the references together. Check all three images on desktop and a
390px-wide page after replacement. Clicking a phone opens the full capture.

Download files are separate: `web/src/lib/download-release.ts` contains a verified
release snapshot and reads the current public GitHub release. It never constructs
links from the source package version. Refresh the snapshot after a new release
so the fallback stays useful when the GitHub API is unavailable. Installer files
must have `Keating` and an explicit architecture (`arm64`, `x64`, or `universal`)
in the asset name. Terminal archives retain the existing release workflow names.
