import { useCallback, useEffect, useState } from "react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { Toggle } from "./Toggle";

export function ProxyTab() {
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("http://localhost:3001");

  useEffect(() => {
    const storage = getAppStorage();
    storage.settings.get("proxy.enabled").then((v) => {
      if (typeof v === "boolean") setEnabled(v);
    });
    storage.settings.get("proxy.url").then((v) => {
      if (typeof v === "string") setUrl(v);
    });
  }, []);

  const save = useCallback((nextEnabled: boolean, nextUrl: string) => {
    const storage = getAppStorage();
    storage.settings.set("proxy.enabled", nextEnabled);
    storage.settings.set("proxy.url", nextUrl);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Allows browser-based apps to bypass CORS restrictions when calling LLM providers. Required for Z-AI and Anthropic with OAuth token.
      </p>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Use CORS Proxy</span>
        <Toggle
          checked={enabled}
          onChange={(checked) => {
            setEnabled(checked);
            save(checked, url);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-foreground">Proxy URL</label>
        <input
          type="text"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            save(enabled, e.target.value);
          }}
          placeholder="http://localhost:3001"
        />
        <p className="text-xs text-muted-foreground">
          The proxy must forward requests to the upstream provider.
        </p>
      </div>
    </div>
  );
}
