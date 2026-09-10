import { parseDownloadRelease, RELEASE_API_URL } from "../src/lib/download-release";

// No credentials: this snapshot must describe the files visitors can download.
const response = await fetch(RELEASE_API_URL, { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`Public release lookup failed: HTTP ${response.status}`);
const raw = await response.json() as { assets: Record<string, unknown>[] };
const release = parseDownloadRelease(raw);
if (!release?.assets.length) throw new Error("Latest release has no usable published downloads.");
for (let start = 0; start < release.assets.length; start += 4) {
  await Promise.all(release.assets.slice(start, start + 4).map(async (asset) => {
    const head = await fetch(asset.url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(30_000) });
    if (head.status !== 200) throw new Error(`${asset.name}: HTTP ${head.status}; snapshot left unchanged.`);
  }));
}
const names = new Set(release.assets.map((asset) => asset.name));
const snapshot = {
  verified_at: new Date().toISOString(),
  tag_name: release.tag,
  draft: false,
  prerelease: false,
  assets: raw.assets.filter((asset) => names.has(String(asset.name))).map(({ name, browser_download_url, size, state }) => ({ name, browser_download_url, size, state })),
};
await Bun.write(new URL("../src/lib/download-release-snapshot.json", import.meta.url), JSON.stringify(snapshot, null, 2) + "\n");
console.log(`Verified HTTP 200 for ${release.assets.length} ${release.tag} downloads and refreshed the fallback snapshot.`);
