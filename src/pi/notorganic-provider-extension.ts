import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { NOTORGANIC_PROVIDER_ID } from "../core/notorganic-auth.js";
import { createNotOrganicProviderConfig } from "./notorganic-provider.js";

export default function registerNotOrganicProvider(pi: ExtensionAPI): void {
  pi.registerProvider(NOTORGANIC_PROVIDER_ID, createNotOrganicProviderConfig());
}
