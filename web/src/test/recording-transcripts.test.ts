import { expect, test } from "bun:test";
import { recordingHasTranscript, rememberRecordingTranscript } from "../lib/recording-transcripts";

test("ordinary accompanying text cannot substitute for transcription", () => {
	const recording = new Blob(["audio"]);
	expect(recordingHasTranscript(recording, "Explain this recording")).toBe(false);
	rememberRecordingTranscript(recording, "   ");
	expect(recordingHasTranscript(recording, "Explain this recording")).toBe(false);
});

test("a successful transcript only covers its recording while present in the message", () => {
	const recording = new File(["audio"], "recording.wav");
	rememberRecordingTranscript(recording, "  Explain fractions.  ");
	expect(recordingHasTranscript(recording, "Please help: Explain fractions.")).toBe(true);
	expect(recordingHasTranscript(recording, "Explain this recording")).toBe(false);
	expect(recordingHasTranscript(new File(["different audio"], "recording.wav"), "Explain fractions.")).toBe(false);
	expect(recordingHasTranscript(undefined, "Explain fractions.")).toBe(false);
});
