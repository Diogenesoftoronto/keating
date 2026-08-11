/**
 * A minimal cookie jar for the course API.
 *
 * Course auth is a server-set session cookie. React Native's networking stack
 * usually persists cookies natively, but that is platform-dependent and
 * invisible to tests, so the client also keeps its own jar: it records any
 * `set-cookie` it can see and replays it on later requests. Belt and braces —
 * whichever mechanism works, the session survives an app restart.
 *
 * Parsing lives here, free of storage and React Native imports, so it can be
 * exercised directly under `bun test`.
 */

export type CookieJar = Readonly<Record<string, string>>;

/**
 * Pulls `name=value` pairs out of a `set-cookie` header, ignoring attributes
 * (`Path`, `HttpOnly`, `Max-Age`, …). React Native folds multiple cookies into
 * one comma-joined header, so splitting has to skip the commas inside an
 * `Expires=Wed, 09 Jun 2027 …` date.
 */
export function parseSetCookie(header: string | null | undefined): Record<string, string> {
  if (!header) return {};
  const jar: Record<string, string> = {};
  for (const chunk of splitCookieHeader(header)) {
    const pair = chunk.split(";", 1)[0]?.trim();
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    // An empty value with an expiry in the past is a deletion; drop the name
    // rather than replaying a blank cookie.
    if (name) jar[name] = value;
  }
  return jar;
}

function splitCookieHeader(header: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < header.length; index += 1) {
    const character = header[index]!;
    if (character !== ",") {
      current += character;
      continue;
    }
    // A comma starts a new cookie only when what follows looks like `name=`
    // before the next `;` — otherwise it belongs to a date inside an attribute.
    const rest = header.slice(index + 1);
    if (/^\s*[^=;,\s]+=/.test(rest)) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function mergeCookies(jar: CookieJar, incoming: Record<string, string>): CookieJar {
  const next: Record<string, string> = { ...jar };
  for (const [name, value] of Object.entries(incoming)) {
    if (value === "") delete next[name];
    else next[name] = value;
  }
  return next;
}

/** Serialises the jar into a `Cookie` request header, or `null` when empty. */
export function serializeCookies(jar: CookieJar): string | null {
  const entries = Object.entries(jar);
  if (entries.length === 0) return null;
  return entries.map(([name, value]) => `${name}=${value}`).join("; ");
}
