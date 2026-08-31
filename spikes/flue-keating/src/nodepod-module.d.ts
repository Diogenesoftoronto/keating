declare module "@scelar/nodepod" {
  export interface NodePod {
    run(command: string, options?: unknown): Promise<unknown>;
  }
}
