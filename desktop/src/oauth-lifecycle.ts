import {
	startOAuthCallbackReceiver,
	validOAuthCallbackState,
	isDesktopOAuthProvider,
	type DesktopOAuthProvider,
	OAUTH_CALLBACK_ATTEMPT_TTL_MS,
	type OAuthCallbackReceiver,
} from "./oauth-callback.js";

/** One bounded, expiring authorization attempt; never reserves a port at startup. */
export class DesktopOAuthLifecycle {
	private receiver: OAuthCallbackReceiver | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private serial: Promise<void> = Promise.resolve();
	private generation = 0;
	private pending = 0;
	constructor(
		private readonly deliver: (url: string) => void,
		private readonly start = startOAuthCallbackReceiver,
		private readonly clearPending = () => {},
	) {}

	prepare(state: string, provider: DesktopOAuthProvider = "openai-codex"): Promise<{ available: boolean }> {
		if (!isDesktopOAuthProvider(provider)) return Promise.reject(new Error("Unsupported desktop OAuth provider."));
		if (!validOAuthCallbackState(state)) return Promise.reject(new Error("Invalid OAuth callback state."));
		if (this.pending >= 4) return Promise.resolve({ available: false });
		this.clearPending();
		const generation = ++this.generation;
		this.pending++;
		const prepared = this.serial.then(async () => {
			await this.stopReceiver();
			if (generation !== this.generation) return { available: false };
			const result = await this.start({
				expectedState: state,
				provider,
				onCallback: ({ url }) => {
					if (generation !== this.generation) throw new Error("Sign-in was cancelled.");
					this.deliver(url.toString());
				},
			});
			if (!result.available) return { available: false };
			if (generation !== this.generation) {
				await result.receiver.stop();
				return { available: false };
			}
			this.receiver = result.receiver;
			this.timer = setTimeout(() => { void this.cancel(); }, OAUTH_CALLBACK_ATTEMPT_TTL_MS);
			this.timer.unref?.();
			return { available: true };
		}).finally(() => { this.pending--; });
		this.serial = prepared.then(() => {}, () => {});
		return prepared;
	}

	cancel(): Promise<void> {
		this.clearPending();
		++this.generation; // Revoke delivery immediately, even while a bind is pending.
		const cancelled = this.serial.then(() => this.stopReceiver());
		this.serial = cancelled.catch(() => {});
		return cancelled;
	}

	private async stopReceiver(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const receiver = this.receiver;
		this.receiver = null;
		await receiver?.stop();
	}
}
