/** Storybook-only microphone source. Exercises real MediaRecorder without hardware. */
export const recordingFixtureStreams: MediaStream[] = [];
export const recordingFixtureRevokedUrls: string[] = [];

export function installRecordingFixture() {
  const original = navigator.mediaDevices.getUserMedia;
  const originalRevoke = URL.revokeObjectURL;
  const contexts: AudioContext[] = [];
  recordingFixtureStreams.length = 0;
  recordingFixtureRevokedUrls.length = 0;
  URL.revokeObjectURL = (url) => { recordingFixtureRevokedUrls.push(url); originalRevoke.call(URL, url); };
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext();
    contexts.push(context);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    oscillator.frequency.value = 220;
    gain.gain.value = 0.02;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    await context.resume();
    recordingFixtureStreams.push(destination.stream);
    return destination.stream;
  };
  return () => {
    navigator.mediaDevices.getUserMedia = original;
    URL.revokeObjectURL = originalRevoke;
    recordingFixtureStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    contexts.forEach((context) => void context.close());
  };
}
