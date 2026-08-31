import { createFlueClient, type FlueClient } from "@flue/sdk";

export type BrowserFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface BrowserRequestAuthorization {
  url: string;
  method: string;
}

export interface BrowserConversationOptions {
  /** Fully-qualified, account-authorized Not Organic conversation URL. */
  url: string;
  /** Resolve fresh DPoP/capability headers for each concrete SDK request. */
  authorizeRequest: (
    request: BrowserRequestAuthorization,
  ) => Promise<HeadersInit>;
  fetch?: BrowserFetch;
}

/**
 * The supported browser boundary: the UI consumes a remotely hosted Flue
 * conversation using fetch. Account authority remains with Not Organic.
 */
export function createBrowserConversation(
  options: BrowserConversationOptions,
): FlueClient {
  const transport = options.fetch ?? globalThis.fetch.bind(globalThis);
  const authorizedFetch: BrowserFetch = async (input, init) => {
    const url =
      input instanceof Request ? input.url : new URL(input.toString()).toString();
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const accountHeaders = await options.authorizeRequest({ url, method });
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    new Headers(accountHeaders).forEach((value, name) => headers.set(name, value));

    return transport(input, { ...init, headers });
  };

  return createFlueClient({
    url: options.url,
    fetch: authorizedFetch as typeof globalThis.fetch,
  });
}
