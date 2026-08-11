import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type {
  PortableLearnerFileIo,
  PortableLearnerPickedFile,
  PortableLearnerTemporaryFile,
} from "./learner-portable-file";

function pickedFile(file: File): PortableLearnerPickedFile {
  return {
    name: file.name,
    sizeBytes: file.size,
    readText: () => file.text(),
  };
}

function temporaryFile(file: File): PortableLearnerTemporaryFile {
  return {
    uri: file.uri,
    async writeText(text: string): Promise<void> {
      file.create({ intermediates: true, overwrite: true });
      file.write(text, { encoding: "utf8" });
    },
    async delete(): Promise<void> {
      // Expo's modern File API is synchronous; retaining an async contract makes
      // the native adapter interchangeable with Bun-testable fakes.
      file.delete();
    },
  };
}

/** Native adapter kept separate so pure import/export tests never load Expo modules. */
export function createExpoPortableLearnerFileIo(): PortableLearnerFileIo {
  return {
    async pickJsonFile(): Promise<PortableLearnerPickedFile | null> {
      const selection = await File.pickFileAsync({
        mimeTypes: ["application/json", "text/json"],
        multipleFiles: false,
      });
      if (selection.canceled) return null;
      return pickedFile(selection.result);
    },
    async createTemporaryJsonFile(name: string): Promise<PortableLearnerTemporaryFile> {
      return temporaryFile(new File(Paths.cache, name));
    },
    isSharingAvailable: () => Sharing.isAvailableAsync(),
    share: (uri, options) => Sharing.shareAsync(uri, options),
  };
}
