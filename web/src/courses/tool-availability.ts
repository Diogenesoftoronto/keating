/** Check the course service independently of browser model-provider sign-in. */
export async function courseToolsAvailable(fetcher: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch> = fetch): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher("/api/courses/session", { signal: controller.signal, credentials: "same-origin" });
        if (!response.ok) return false;
        const body = await response.json();
        return typeof body?.account?.id === "string" && body.account.id.length > 0
          && ["hosted", "local", "development"].includes(body.account.mode);
      })(),
      new Promise<false>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(false); }, 2000);
      }),
    ]);
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); }
}
