interface Sound {
  set(on: boolean): void;
  unlock(): void;
  dispose(): void;
  readonly on: boolean;
}
export const RecessAudio: { create(): Sound };
