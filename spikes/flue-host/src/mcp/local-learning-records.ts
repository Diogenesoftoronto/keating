export interface LocalLearningRecordsMcpConfig {
  url: string;
  resolveAuth: () => string | Promise<string>;
}

let configuredConnection: LocalLearningRecordsMcpConfig | undefined;

/**
 * Supplies the process-local endpoint and credential resolver used by the
 * host. A deployment adapter can configure this without putting a token in
 * the agent definition; tests clear it after each run.
 */
export function configureLocalLearningRecordsMcp(
  config: LocalLearningRecordsMcpConfig | undefined,
): void {
  configuredConnection = config;
}

export function getLocalLearningRecordsMcpConfig():
  | LocalLearningRecordsMcpConfig
  | undefined {
  if (configuredConnection) return configuredConnection;

  const url = process.env.KEATING_LEARNING_RECORDS_MCP_URL;
  if (!url) return undefined;

  return {
    url,
    resolveAuth() {
      const token = process.env.KEATING_LEARNING_RECORDS_MCP_TOKEN;
      if (!token) {
        throw new Error(
          "KEATING_LEARNING_RECORDS_MCP_TOKEN is required when the local learning-records MCP connection is enabled.",
        );
      }
      return token;
    },
  };
}
