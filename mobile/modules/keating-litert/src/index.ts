import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";

export interface LiteRTDelta { requestId: string; text: string }
declare class KeatingLiteRT extends NativeModule<{ onDelta: (event: LiteRTDelta) => void }> {
  readonly runtimeVersion: string;
  readonly supported: boolean;
  readonly labelScorerVersion: string;
  getDirectoryAsync(): Promise<string>;
  createFileAsync(uri: string): Promise<void>;
  sha256Async(uri: string): Promise<string>;
  generateAsync(requestId: string, uri: string, system: string, messagesJson: string, temperature: number): Promise<string>;
  scoreLabelsAsync(requestId: string, uri: string, messageJson: string, count: number): Promise<number[]>;
  cancelGeneration(requestId: string): void;
  unloadAsync(): Promise<void>;
}

// Expo Go and web retain the normal hosted paths without trying to load a browser runtime.
export const nativeLiteRT = requireOptionalNativeModule<KeatingLiteRT>("KeatingLiteRT");
