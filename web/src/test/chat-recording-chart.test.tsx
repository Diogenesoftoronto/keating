import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordingInputChart } from "../components/chat/SpeechComposerControl";

test("the microphone chart names the live input and exposes duration alongside the canvas", () => {
  const html = renderToStaticMarkup(<RecordingInputChart stream={{} as MediaStream} />);
  expect(html).toContain('aria-label="Microphone input, Recording"');
  expect(html).toContain('aria-label="Recording duration 0 seconds"');
  expect(html).toContain("<canvas");
});
