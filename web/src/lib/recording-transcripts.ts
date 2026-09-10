// Bind successful transcription to the actual recording, never to nearby text.
const transcripts = new WeakMap<Blob, string>();

export function rememberRecordingTranscript(recording: Blob, text: string): void {
	if (text.trim()) transcripts.set(recording, text.trim());
}

export function recordingHasTranscript(recording: Blob | undefined, text: string): boolean {
	const transcript = recording && transcripts.get(recording);
	return Boolean(transcript && text.includes(transcript));
}
