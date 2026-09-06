export interface SetupChoice<T extends string = string> {
  label: string;
  value: T;
  hint?: string;
}
