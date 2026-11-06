import { definePlugin } from "nitro";
import { useStorage } from "nitro/storage";
import fsDriver from "unstorage/drivers/fs";

/**
 * nitro.config `storage` bases are fixed at build time, so the `.data/…`
 * fallback was baked into the image and production wrote shares, courses and
 * submissions to the container's disk, losing them on every deploy. Remount
 * each store on the directory its variable names when the server starts.
 */
export const PERSISTENT_STORES = [
  ["keating:share", "KEATING_SHARE_STORAGE_DIR"],
  ["keating:courses", "KEATING_COURSES_STORAGE_DIR"],
  ["keating:course-materials", "KEATING_COURSE_MATERIALS_STORAGE_DIR"],
  ["keating:submission-attachments", "KEATING_SUBMISSION_STORAGE_DIR"],
] as const;

export function persistentStorageMounts(env: Record<string, string | undefined>): Array<{ mount: string; base: string }> {
  return PERSISTENT_STORES.flatMap(([mount, variable]) => {
    const base = env[variable]?.trim();
    return base ? [{ mount, base }] : [];
  });
}

export default definePlugin(() => {
  const storage = useStorage();
  for (const { mount, base } of persistentStorageMounts(process.env)) {
    storage.unmount(mount, false);
    storage.mount(mount, fsDriver({ base }));
  }
});
