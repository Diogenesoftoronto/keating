import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NotOrganicAccountMenuItem } from "../components/NotOrganicAccountMenuItem";

const settings = {
  VITE_NOTORGANIC_PUBLIC_ISSUER: "https://provider.test",
  VITE_NOTORGANIC_AUTHORIZATION_URL: "https://portal.test/authorize",
  VITE_NOTORGANIC_CLIENT_ID: "https://chat.keating.help",
  VITE_NOTORGANIC_REDIRECT_URI: "https://chat.keating.help/notorganic/callback",
};
const originals = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let savedSession: string | null = null;
const render = () => renderToStaticMarkup(<NotOrganicAccountMenuItem className="chat-account-action" onSignIn={() => {}} />);

beforeEach(() => {
  Object.assign(process.env, settings);
  savedSession = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => savedSession, removeItem: () => { savedSession = null; } },
  });
});

afterEach(() => {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("chat account action", () => {
  it("offers a named logout button for a connected account without leaving chat", () => {
    savedSession = JSON.stringify({ accessToken: "test-access", expiresAt: Date.now() + 300_000 });
    const html = render();
    expect(html).toContain("<button");
    expect(html).toContain("type=\"button\"");
    expect(html).toContain("Log out</button>");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("Sign in</button>");
  });

  it("keeps logout available while the short-lived access token needs renewal", () => {
    savedSession = JSON.stringify({ accessToken: "expired-access", expiresAt: Date.now() - 1, refreshToken: "test-refresh", refreshExpiresAt: Date.now() + 86_400_000 });
    expect(render()).toContain("Log out</button>");
  });

  it("offers account sign-in after the local session is removed", () => {
    expect(render()).toContain("Sign in</button>");
    expect(render()).not.toContain("Log out</button>");
  });
});
