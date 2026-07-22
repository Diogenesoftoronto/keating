# General Translation localization guide

Keating uses General Translation with a Canadian-first locale policy.

## Locales

- Source/default locale: `en-CA` (Canadian English).
- Primary translated locale: `fr-CA` (Canadian French / Quebec French).

Do not add generic `en`, `en-US`, `fr`, or `fr-FR` as product locales unless a later product decision explicitly expands the locale matrix.

## Voice

English source copy should be warm, direct, teacherly Canadian English. Prefer Canadian user-facing terms such as `postal code`, `province or territory`, `colour`, `favourite`, and `centre` when those words appear in prose. Do not rename code identifiers just to use Canadian spelling.

French translation should be natural Canadian French. Learner-facing tutoring copy should use `tu` consistently. Settings, security, and destructive-action copy can use concise neutral imperatives where that reads better than repeatedly choosing `tu` or `vous`.

## General Translation element rules

- Use `<T>` for visible JSX text.
- Use `useGT()` for string props and programmatic UI strings: placeholders, accessibility labels, tab labels, alert titles/bodies, error banners, and button labels built in code.
- Use `<Var>` for user-generated, provider, model, file path, and brand/product values inside translated sentences.
- Use `<Num>` for counts, scores, percentages, and other numbers inside translated copy.
- Use `<DateTime>` for dates/times.
- Use `<Currency>` for money or credit purchase copy.
- Use `<Plural>` or `<Branch>` when a count or condition changes sentence grammar.

Do not translate model responses, chat transcripts, API keys, provider IDs, model IDs, code snippets, command examples, file paths, or user-private content by default. If private/dynamic content must appear in translated UI copy, wrap it with `<Var>`.

## Build and secrets

Production clients must not expose `GT_API_KEY`. Generate static translations before production builds in CI with the server-side General Translation key. Runtime development keys may be exposed only with dev-prefixed environment variables intended for local development.

The first checked-in translation snapshots are intentionally empty; they provide the local fallback shape until CI/developers run the GT translation command for `fr-CA`.
