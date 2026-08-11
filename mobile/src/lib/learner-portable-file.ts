import type { PortableLearnerEnvelope } from "@keating/learner-contracts";
import {
  MAX_PORTABLE_LEARNER_JSON_BYTES,
  PortableLearnerJsonError,
  formatPortableLearnerCountSummary,
  parsePortableLearnerJson,
  serializePortableLearnerJson,
  summarizePortableLearnerData,
} from "./learner-portable-json";

export const PORTABLE_LEARNER_JSON_MIME_TYPE = "application/json";

export type PortableLearnerFileErrorCode =
  | "file-unavailable"
  | "file-too-large"
  | "share-unavailable"
  | "share-failed"
  | "temporary-file-failed";

/** A user-safe file boundary error. Never attach the selected file text as a cause. */
export class PortableLearnerFileError extends Error {
  constructor(
    public readonly code: PortableLearnerFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PortableLearnerFileError";
  }
}

export interface PortableLearnerPickedFile {
  /** Display-only file name. This is never included in the portable payload. */
  name: string;
  /** Picker metadata, used to enforce the bound before reading file text. */
  sizeBytes: number | null | undefined;
  readText(): Promise<string>;
}

export interface PortableLearnerTemporaryFile {
  uri: string;
  writeText(text: string): Promise<void>;
  delete(): Promise<void>;
}

export interface PortableLearnerFileIo {
  /** Returns null when the learner cancels the system picker. */
  pickJsonFile(): Promise<PortableLearnerPickedFile | null>;
  createTemporaryJsonFile(name: string): Promise<PortableLearnerTemporaryFile>;
  isSharingAvailable(): Promise<boolean>;
  share(uri: string, options: { mimeType: string; dialogTitle: string }): Promise<void>;
}

export interface PortableLearnerImportPreview {
  name: string;
  envelope: PortableLearnerEnvelope;
  summary: string;
}

export interface PortableLearnerExportResult {
  name: string;
}

export interface PortableLearnerFileOptions {
  /** A lower UI limit may be supplied, but callers cannot exceed the repository cap. */
  maximumBytes?: number;
  now?: () => Date;
}

function maximumBytes(options: PortableLearnerFileOptions | undefined): number {
  const requested = options?.maximumBytes;
  if (!Number.isSafeInteger(requested) || requested === undefined || requested < 1) {
    return MAX_PORTABLE_LEARNER_JSON_BYTES;
  }
  return Math.min(requested, MAX_PORTABLE_LEARNER_JSON_BYTES);
}

function checkedMetadataSize(file: PortableLearnerPickedFile, options?: PortableLearnerFileOptions): number {
  const size = file.sizeBytes;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new PortableLearnerFileError(
      "file-unavailable",
      "Keating could not inspect that file. Choose a readable JSON learner export and try again.",
    );
  }
  if (size > maximumBytes(options)) {
    throw new PortableLearnerFileError(
      "file-too-large",
      "This learner export is too large to import on this device.",
    );
  }
  return size;
}

function safeFileName(name: string): string {
  const trimmed = name.trim();
  return trimmed || "learner-export.json";
}

/**
 * Reads and validates one already-chosen file without changing learner data.
 * The picker metadata is bounded before text is read so enormous inputs do not
 * enter JSON.parse or the import merge path.
 */
export async function preparePortableLearnerImport(
  file: PortableLearnerPickedFile,
  options?: PortableLearnerFileOptions,
): Promise<PortableLearnerImportPreview> {
  const maxBytes = maximumBytes(options);
  checkedMetadataSize(file, options);

  let text: string;
  try {
    text = await file.readText();
  } catch {
    throw new PortableLearnerFileError(
      "file-unavailable",
      "Keating could not read that file. Choose a readable JSON learner export and try again.",
    );
  }

  let envelope: PortableLearnerEnvelope;
  try {
    envelope = parsePortableLearnerJson(text, { maximumBytes: maxBytes });
  } catch (error) {
    if (error instanceof PortableLearnerJsonError) throw error;
    // Defensive only: the parser deliberately emits payload-safe domain errors.
    throw new PortableLearnerFileError(
      "file-unavailable",
      "Keating could not validate that file. Choose a Keating learner export and try again.",
    );
  }

  return {
    name: safeFileName(file.name),
    envelope,
    summary: formatPortableLearnerCountSummary(summarizePortableLearnerData(envelope.payload)),
  };
}

/** Opens the picker and returns a preview only; cancel is intentionally a no-op. */
export async function pickPortableLearnerImport(
  io: Pick<PortableLearnerFileIo, "pickJsonFile">,
  options?: PortableLearnerFileOptions,
): Promise<PortableLearnerImportPreview | null> {
  const file = await io.pickJsonFile();
  if (!file) return null;
  return preparePortableLearnerImport(file, options);
}

function exportDateStamp(date: Date): string {
  if (Number.isNaN(date.getTime())) return "undated";
  return date.toISOString().replace(/[.:]/g, "");
}

/** A date-stamped cache filename; cache storage is always deleted after sharing. */
export function portableLearnerExportFileName(date = new Date()): string {
  return `keating-learner-export-${exportDateStamp(date)}.json`;
}

/**
 * Serializes a validated snapshot, shares it as JSON, and removes the temporary
 * cache file on every success/failure path after creation.
 */
export async function exportPortableLearnerFile(
  io: Omit<PortableLearnerFileIo, "pickJsonFile">,
  envelope: unknown,
  options?: PortableLearnerFileOptions,
): Promise<PortableLearnerExportResult> {
  const text = serializePortableLearnerJson(envelope);
  const name = portableLearnerExportFileName(options?.now?.() ?? new Date());
  let temporary: PortableLearnerTemporaryFile | undefined;

  try {
    temporary = await io.createTemporaryJsonFile(name);
    await temporary.writeText(text);

    if (!await io.isSharingAvailable()) {
      throw new PortableLearnerFileError(
        "share-unavailable",
        "Sharing is not available on this device. Save or export your learner data from a device that supports sharing.",
      );
    }

    try {
      await io.share(temporary.uri, {
        mimeType: PORTABLE_LEARNER_JSON_MIME_TYPE,
        dialogTitle: "Export Keating learner data",
      });
    } catch {
      throw new PortableLearnerFileError(
        "share-failed",
        "Keating could not open sharing. Try again or use another sharing destination.",
      );
    }
    return { name };
  } catch (error) {
    if (error instanceof PortableLearnerFileError || error instanceof PortableLearnerJsonError) throw error;
    throw new PortableLearnerFileError(
      "temporary-file-failed",
      "Keating could not prepare a learner export. Check device storage and try again.",
    );
  } finally {
    if (temporary) {
      try {
        await temporary.delete();
      } catch {
        // Cleanup must not turn a completed share into a false failure.
      }
    }
  }
}
