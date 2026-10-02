This patch seeds 30 existing public navigation/footer/support messages in Canadian English/French using Keating’s installed General Translation APIs. Each message has canonical ICU and JSX hashes because the existing UI uses both `gt()` and `<T>`.

`npm run gt:seed-navigation` regenerates this slice from readable navigation-source.json, preserving other catalog entries. `npm run gt:check-local` checks all 120 EN/FR × ICU/JSX real React renders with translation endpoints disabled. It has no credentials and makes no paid calls.

This slice does not cover the homepage body, onboarding, settings, authenticated teaching, billing, mobile or TUI. Mobile currently declares en/fr despite the repository’s Canadian locale guide and also has empty catalogs; reconcile that policy in a separate native change. Never claim whole-app French coverage from these seeded entries. Legal link labels are translated, but legal documents are untouched.

Apply against the original dirty checkout only after confirming web package/catalog files still match this patch’s baseline. No auth/profile files or existing UI components are modified.
