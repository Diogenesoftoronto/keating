export interface SourceEditBase {
  file: string;
  search: string;
  replace: string;
}

export type SourceEdit<ReasonRequired extends boolean = false> = SourceEditBase & (
  ReasonRequired extends true ? { reason: string } : { reason?: string }
);

export interface EditResult {
  success: boolean;
  file: string;
  message: string;
  diff?: {
    linesRemoved: number;
    linesAdded: number;
    charDelta: number;
  };
}
