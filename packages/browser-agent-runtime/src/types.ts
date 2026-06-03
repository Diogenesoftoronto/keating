export type SandboxKind =
  | "browser-memory"
  | "browser-nodepod"
  | "remote-daytona"
  | "remote-microsandbox"
  | "relay";

export type SecretMode = "none" | "browser-byok" | "server-broker";
export type PersistenceMode = "memory" | "indexeddb" | "remote-disk" | "remote-snapshot";

export interface SandboxCapabilities {
  browserLocal: boolean;
  secureIsolation: boolean;
  nativeBinaries: boolean;
  filesystem: boolean;
  process: boolean;
  sessions: boolean;
  preview: boolean;
  snapshots: boolean;
  packageInstall: boolean;
  outboundNetwork: boolean | "limited";
  inboundNetwork: boolean;
  secrets: SecretMode;
  persistence: PersistenceMode;
}

export interface SandboxRequirement {
  secureIsolation?: boolean;
  nativeBinaries?: boolean;
  filesystem?: boolean;
  process?: boolean;
  sessions?: boolean;
  preview?: boolean;
  snapshots?: boolean;
  packageInstall?: boolean;
  outboundNetwork?: boolean;
  inboundNetwork?: boolean;
  secrets?: Exclude<SecretMode, "none">;
}

export interface CapabilityDecision {
  ok: boolean;
  missing: Array<keyof SandboxRequirement>;
}

export interface SandboxFileInfo {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modTime: string;
}

export interface SandboxFs {
  readFile(path: string, encoding?: "utf8"): Promise<string | Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  listFiles(path?: string): Promise<SandboxFileInfo[]>;
  getFileDetails(path: string): Promise<SandboxFileInfo>;
  createFolder(path: string, mode?: string): Promise<void>;
  deleteFile(path: string, recursive?: boolean): Promise<void>;
}

export interface ExecuteOptions {
  cwd?: string;
  timeoutSeconds?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  result: string;
}

export interface SessionExecuteRequest {
  command: string;
  runAsync?: boolean;
  suppressInputEcho?: boolean;
  cwd?: string;
}

export interface SessionExecResult extends ExecResult {
  cmdId: string;
  output: string;
}

export interface SandboxProcess {
  executeCommand(command: string, options?: ExecuteOptions): Promise<ExecResult>;
  createSession?(sessionId: string): Promise<void>;
  executeSessionCommand?(
    sessionId: string,
    request: SessionExecuteRequest,
    timeoutSeconds?: number
  ): Promise<SessionExecResult>;
}

export interface PreviewLink {
  url: string;
  token?: string;
}

export interface SandboxPreview {
  getPreviewLink(port: number): Promise<PreviewLink>;
}

export interface SandboxSnapshot {
  id: string;
  createdAt: string;
  data: unknown;
}

export interface SandboxSnapshots {
  create(name?: string): Promise<SandboxSnapshot>;
  restore(snapshot: SandboxSnapshot): Promise<void>;
}

export interface AgentSandbox {
  id: string;
  kind: SandboxKind;
  workDir: string;
  capabilities: SandboxCapabilities;
  fs: SandboxFs;
  process: SandboxProcess;
  preview?: SandboxPreview;
  snapshots?: SandboxSnapshots;
  dispose?(): Promise<void>;
}

export interface SandboxRoute {
  sandbox: AgentSandbox;
  decision: CapabilityDecision;
  fallbackReason?: string;
}
