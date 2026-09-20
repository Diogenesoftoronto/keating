import type { PortableLearnerFileIo, PortableLearnerTemporaryFile } from "../learner-portable-file";

type ShareIo = Pick<PortableLearnerFileIo, "createTemporaryJsonFile" | "isSharingAvailable" | "share">;
let exportSequence = 0;

/** Opens the native share sheet only while its originating quiz is still current. */
export async function shareQuizPerformanceEvidence(
  evidence: unknown,
  io: ShareIo,
  isCurrent: () => boolean,
): Promise<"shared" | "cancelled"> {
  let temporary: PortableLearnerTemporaryFile | undefined;
  try {
    if (!isCurrent()) return "cancelled";
    if (!await io.isSharingAvailable()) throw new Error("Sharing is unavailable on this device.");
    if (!isCurrent()) return "cancelled";
    const text = JSON.stringify(evidence, null, 2) + "\n";
    temporary = await io.createTemporaryJsonFile(`keating-quiz-estimates-${Date.now()}-${++exportSequence}.json`);
    if (!isCurrent()) return "cancelled";
    await temporary.writeText(text);
    if (!isCurrent()) return "cancelled";
    await io.share(temporary.uri, { mimeType: "application/json", dialogTitle: "Share quiz estimate records" });
    return "shared";
  } finally {
    // The cache file may contain assessed answers. Always attempt cleanup, even
    // after a write error, cancellation, or a failed native share sheet.
    if (temporary) await temporary.delete().catch(() => undefined);
  }
}
