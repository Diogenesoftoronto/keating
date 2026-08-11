import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { CourseMaterial } from "./types";
import { courseMaterialDownloadRequest } from "./client";

function safeFileName(material: CourseMaterial): string {
  const source = material.fileName?.trim() || material.title.trim() || `course-material-${material.id}`;
  const safe = source.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return safe || `course-material-${material.id}`;
}

/** Downloads with the native course credential, then opens the OS share/view sheet. */
export async function shareCourseMaterial(courseId: string, material: CourseMaterial): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error("This device cannot open downloaded course materials.");

  const request = await courseMaterialDownloadRequest(courseId, material.id);
  const destination = new File(Paths.cache, safeFileName(material));
  const downloaded = await File.downloadFileAsync(request.url, destination, {
    headers: request.headers,
    idempotent: true,
  });
  await Sharing.shareAsync(downloaded.uri, {
    dialogTitle: material.title,
    ...(material.mimeType ? { mimeType: material.mimeType } : {}),
  });
}
