import { NotOrganicPublicClient, publicClientConfig, publicClientMaxCostMicrousd, type NotOrganicProviderSession } from "./public-client";
import { TUTOR_CONSULTATION_SCOPE, tutorConsultationInput, tutorConsultationResult, type TutorConsultationResult } from "../../../shared/tutor-consultation";

interface TutorTransport {
  getSession(): NotOrganicProviderSession | null;
  activeSession(): Promise<NotOrganicProviderSession | null>;
  headersFor(method: string, url: string, initial?: HeadersInit): Promise<Headers>;
}

/** One consultation, one signed attempt. Provider secrets remain in the gateway. */
export class TutorConsultationClient {
  constructor(
    private readonly transport: TutorTransport,
    private readonly issuer: string,
    private readonly maxCostMicrousd: number,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  available(): boolean {
    return this.transport.getSession()?.scope.split(/\s+/).includes(TUTOR_CONSULTATION_SCOPE) === true;
  }

  async consult(value: Record<string, unknown>, signal?: AbortSignal): Promise<TutorConsultationResult> {
    const body = tutorConsultationInput(value);
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(this.maxCostMicrousd) || this.maxCostMicrousd <= 0) throw new Error("Tutor consultation budget is invalid.");
    const session = await this.transport.activeSession();
    if (!session?.scope.split(/\s+/).includes(TUTOR_CONSULTATION_SCOPE)) {
      throw new Error("Allow Ampersand Tutor access in Not Organic before consulting the tutor.");
    }
    const sameAccount = () => {
      const current = this.transport.getSession();
      if (!current || (session.id ? current.id !== session.id : current.accessToken !== session.accessToken)) throw new Error("Your Not Organic account changed. Start a new tutor consultation.");
      if (!current.scope.split(/\s+/).includes(TUTOR_CONSULTATION_SCOPE)) throw new Error("Ampersand Tutor permission is no longer available.");
    };
    const url = `${this.issuer.replace(/\/+$/, "")}/v1/tutor/consult`;
    const headers = await this.transport.headersFor("POST", url, { "content-type": "application/json" });
    sameAccount();
    signal?.throwIfAborted();
    headers.set("idempotency-key", `keating_tutor_${crypto.randomUUID()}`);
    headers.set("x-notorganic-max-cost-microusd", String(this.maxCostMicrousd));
    const response = await this.fetcher(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    sameAccount();
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 401 || response.status === 403
        ? "Reconnect Not Organic with Ampersand Tutor permission. This consultation was not retried."
        : `Tutor consultation failed (${response.status}). It was not retried; its billing outcome may require checking Not Organic usage.`);
    }
    const text = await response.text();
    sameAccount();
    if (text.length > 1_000_000) throw new Error("Tutor consultation response exceeded its size limit.");
    return tutorConsultationResult(JSON.parse(text));
  }
}

export function tutorConsultationClient(): TutorConsultationClient | null {
  const config = publicClientConfig();
  return config ? new TutorConsultationClient(new NotOrganicPublicClient(config), config.issuer, publicClientMaxCostMicrousd()) : null;
}
