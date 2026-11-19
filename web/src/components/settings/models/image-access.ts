import { useEffect, useState } from "react";
import { useKeatingUiSettings } from "../../../hooks/use-ui-settings";
import { getImageGenerator } from "../../../lib/image-generators";
import { getAppStorage } from "../../../keating/app-storage";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../../../keating/model-prefs";
import { notOrganicPublicClient } from "../../../notorganic-provider";
/** Only selected jobs can require a key. Unconfigured catalog entries are optional. */
export function useImageAccess() {
	const [ui] = useKeatingUiSettings();
	const generator = getImageGenerator(ui.imageGenerator);
	const [access, setAccess] = useState<{ id: string; ready: boolean }>();
	useEffect(() => {
		let version = 0;
		async function refresh() {
			const current = ++version;
			if (!generator) return;
			try {
				const ready = generator.needsBaseUrl
					? Boolean(ui.localImageBaseUrl.trim() && ui.imageModel.trim())
					: generator.auth === "notorganic-session"
						? Boolean(await notOrganicPublicClient()?.activeSession())
						: Boolean(
								await getAppStorage().providerKeys.get(generator.providerKey!),
							);
				if (current === version) setAccess({ id: generator.id, ready });
			} catch {
				if (current === version) setAccess(undefined);
			}
		}
		void refresh();
		window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
		return () => {
			version++;
			window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
		};
	}, [generator, ui.localImageBaseUrl, ui.imageModel]);
	return {
		generator,
		ready: access?.id === generator?.id ? access?.ready : undefined,
	};
}
export function useModelsAttention() {
	const { generator, ready } = useImageAccess();
	return ready === false &&
		generator?.auth === "api-key" &&
		!generator.needsBaseUrl
		? "1 needs a key"
		: "";
}
