import { join } from "node:path";

import type {
  ApiKeyCredential as ModernApiKeyCredential,
  AuthEvent,
  AuthPrompt,
  OAuthCredential as ModernOAuthCredential,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { AuthStorage, type AuthCredential } from "@earendil-works/pi-coding-agent";

import { configDir } from "../core/paths.js";

export type ProviderLoginMethod = "oauth" | "api_key";

export interface ProviderLoginChoice {
  id: string;
  name: string;
  modelCount: number;
  methods: readonly ProviderLoginMethod[];
  methodLabels: Partial<Record<ProviderLoginMethod, string>>;
}

export interface ProviderLoginUi {
  prompt(prompt: AuthPrompt): Promise<string | undefined>;
  notify(event: AuthEvent): void;
}

export interface ProviderLoginResult {
  provider: ProviderLoginChoice;
  method: ProviderLoginMethod;
}

interface LoginProvider {
  id: string;
  name: string;
  getModels(): readonly unknown[];
  auth: {
    oauth?: {
      name: string;
      login(callbacks: LoginCallbacks): Promise<ModernOAuthCredential>;
    };
    apiKey?: {
      name: string;
      login?(callbacks: LoginCallbacks): Promise<ModernApiKeyCredential>;
    };
  };
}

interface LoginCallbacks {
  signal?: AbortSignal;
  prompt(prompt: AuthPrompt): Promise<string>;
  notify(event: AuthEvent): void;
}

export interface ProviderLoginDependencies {
  providers?: readonly LoginProvider[];
  saveCredential?: (providerId: string, credential: AuthCredential) => void;
  signal?: AbortSignal;
}

export class ProviderLoginCancelledError extends Error {
  constructor() {
    super("Provider login cancelled.");
    this.name = "ProviderLoginCancelledError";
  }
}

function methodsFor(provider: LoginProvider): ProviderLoginMethod[] {
  const methods: ProviderLoginMethod[] = [];
  if (provider.auth.oauth) methods.push("oauth");
  if (provider.auth.apiKey?.login) methods.push("api_key");
  return methods;
}

function choiceFor(provider: LoginProvider): ProviderLoginChoice {
  return {
    id: provider.id,
    name: provider.name,
    modelCount: provider.getModels().length,
    methods: methodsFor(provider),
    methodLabels: {
      ...(provider.auth.oauth ? { oauth: provider.auth.oauth.name } : {}),
      ...(provider.auth.apiKey?.login ? { api_key: provider.auth.apiKey.name } : {}),
    },
  };
}

/** Built-in catalog exposed by Pi, including its models.dev-generated providers. */
export function interactiveProviderChoices(
  providers: readonly LoginProvider[] = builtinProviders(),
): ProviderLoginChoice[] {
  return providers
    .filter((provider) => methodsFor(provider).length > 0)
    .map(choiceFor)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function storedCredential(credential: ModernApiKeyCredential | ModernOAuthCredential): AuthCredential {
  if (credential.type === "oauth") return credential;
  return {
    type: "api_key",
    // Coding-agent's compatibility storage requires this field. Modern
    // provider logins may legitimately return only provider-scoped env data.
    key: credential.key ?? "",
    ...(credential.env ? { env: credential.env } : {}),
  };
}

/** Authenticate with Pi's provider-owned flow and persist it to this project. */
export async function loginProvider(
  cwd: string,
  providerId: string,
  method: ProviderLoginMethod,
  ui: ProviderLoginUi,
  dependencies: ProviderLoginDependencies = {},
): Promise<ProviderLoginResult> {
  const providers = dependencies.providers ?? builtinProviders();
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const auth = method === "oauth" ? provider.auth.oauth : provider.auth.apiKey;
  if (!auth || !("login" in auth) || typeof auth.login !== "function") {
    throw new Error(`${provider.name} does not support ${method === "oauth" ? "subscription login" : "API key login"}.`);
  }

  const credential = await auth.login({
    signal: dependencies.signal,
    prompt: async (prompt) => {
      const value = await ui.prompt(prompt);
      if (value === undefined) throw new ProviderLoginCancelledError();
      return value;
    },
    notify: (event) => ui.notify(event),
  });

  const normalized = storedCredential(credential);
  if (dependencies.saveCredential) dependencies.saveCredential(provider.id, normalized);
  else AuthStorage.create(join(configDir(cwd), "auth.json")).set(provider.id, normalized);

  return { provider: choiceFor(provider), method };
}
