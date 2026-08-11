import { useStorage } from "nitro/storage";

const COURSE_MATERIAL_STORAGE = "keating:course-materials";

export function courseMaterialStorageKey(
  courseId: string,
  materialId: string,
): string {
  return `course:${courseId}:material:${materialId}`;
}

export async function saveCourseMaterialBytes(
  storageKey: string,
  data: Uint8Array,
): Promise<void> {
  await useStorage(COURSE_MATERIAL_STORAGE).setItemRaw(storageKey, data);
}

export async function getCourseMaterialBytes(
  storageKey: string,
): Promise<Uint8Array | null> {
  const value = await useStorage(COURSE_MATERIAL_STORAGE).getItemRaw(
    storageKey,
  );
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  return null;
}

export async function deleteCourseMaterialBytes(
  storageKey: string,
): Promise<void> {
  await useStorage(COURSE_MATERIAL_STORAGE).removeItem(storageKey);
}
