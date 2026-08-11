import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { NativeTrainingArchive } from "./training-archive";

export async function shareNativeTrainingArchive(archive: NativeTrainingArchive): Promise<void> {
  if (!await Sharing.isAvailableAsync()) {
    throw new Error("Sharing is not available on this device. Export from a device that supports the system share sheet.");
  }
  const file = new File(Paths.cache, archive.filename);
  try {
    file.create({ intermediates: true, overwrite: true });
    file.write(archive.bytes);
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/zip",
      dialogTitle: "Export Keating fine-tuning data",
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Sharing is not available")) throw error;
    throw new Error("Keating could not prepare the fine-tuning archive. Check device storage and try again.");
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // Cleanup cannot turn a completed share into a false failure.
    }
  }
}
