import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";
export interface NeedleEmbeddingBatch { model: string; dimensions: number; vectors: number[][] }
declare class KeatingNeedle extends NativeModule {
  readonly supported: boolean;
  readonly runtimeRevision: string;
  readonly modelIdentity: string | null;
  getModelDirectoryAsync(): Promise<string>;
  /** Create only the fixed resumable download file in private no-backup storage. */
  createModelFileAsync(): Promise<string>;
  /** Only the fixed partial and final model paths are accepted. */
  verifyModelFileAsync(uri: string): Promise<boolean>;
  embedAsync(modelUri: string, texts: string[]): Promise<NeedleEmbeddingBatch>;
}
/** Expo Go, web and unsupported native builds report no available runtime. */
export const nativeNeedle = requireOptionalNativeModule<KeatingNeedle>("KeatingNeedle");
