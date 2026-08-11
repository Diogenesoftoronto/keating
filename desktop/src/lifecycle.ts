export interface ClosableResource {
	close(): Promise<void>;
}

export interface StoppableResource {
	stop(): Promise<void>;
}

/** Process-owned desktop resources outlive macOS windows but not app shutdown. */
export class DesktopLifecycle<TStore extends ClosableResource, TNitro extends StoppableResource> {
	private store: TStore | null = null;
	private storeOpening: Promise<TStore> | null = null;
	private nitro: TNitro | null = null;
	private nitroOpening: Promise<TNitro> | null = null;
	private rendererCleanup: (() => void | Promise<void>) | null = null;
	private shutdownPromise: Promise<void> | null = null;
	private readonly closingTasks = new Set<Promise<void>>();

	async openStore(open: () => Promise<TStore>): Promise<TStore> {
		if (this.shutdownPromise) throw new Error("Desktop lifecycle is shutting down.");
		if (this.store) return this.store;
		if (!this.storeOpening) {
			this.storeOpening = open().then((store) => {
				this.store = store;
				return store;
			}).finally(() => {
				this.storeOpening = null;
			});
		}
		return this.storeOpening;
	}

	/** Track process startup before awaiting it so shutdown can never miss a child. */
	async openNitro(open: () => Promise<TNitro>): Promise<TNitro> {
		if (this.shutdownPromise) throw new Error("Desktop lifecycle is shutting down.");
		if (this.nitro) return this.nitro;
		if (!this.nitroOpening) {
			this.nitroOpening = open().then((runtime) => {
				this.nitro = runtime;
				return runtime;
			}).finally(() => {
				this.nitroOpening = null;
			});
		}
		return this.nitroOpening;
	}

	setNitro(runtime: TNitro): Promise<void> {
		if (this.shutdownPromise) {
			// Startup can race a quit. Join this late child to an in-flight shutdown
			// instead of letting it survive after the app has finished closing.
			return this.trackClose(() => runtime.stop());
		}
		this.nitro = runtime;
		return Promise.resolve();
	}

	setRendererCleanup(cleanup: () => void | Promise<void>): void {
		if (this.shutdownPromise) {
			this.trackClose(async () => { await cleanup(); });
			return;
		}
		const previous = this.rendererCleanup;
		if (previous) this.trackClose(async () => { await previous(); });
		this.rendererCleanup = cleanup;
	}

	private trackClose(close: () => Promise<void>): Promise<void> {
		const task = Promise.resolve().then(close).catch(() => {
			// Shutdown is best effort: keep closing unrelated resources after a failure.
		});
		this.closingTasks.add(task);
		void task.finally(() => this.closingTasks.delete(task));
		return task;
	}

	private async waitForClosingTasks(): Promise<void> {
		while (this.closingTasks.size > 0) {
			await Promise.allSettled([...this.closingTasks]);
		}
	}

	shutdown(): Promise<void> {
		if (this.shutdownPromise) return this.shutdownPromise;
		this.shutdownPromise = (async () => {
			const cleanup = this.rendererCleanup;
			this.rendererCleanup = null;
			if (cleanup) this.trackClose(async () => { await cleanup(); });

			// Capture both promises before awaiting. A resource that was already
			// starting when quit began must be observed and stopped before completion.
			await Promise.allSettled([
				...(this.storeOpening ? [this.storeOpening] : []),
				...(this.nitroOpening ? [this.nitroOpening] : []),
			]);

			const store = this.store;
			this.store = null;
			const nitro = this.nitro;
			this.nitro = null;
			if (store) this.trackClose(() => store.close());
			if (nitro) this.trackClose(() => nitro.stop());
			await this.waitForClosingTasks();
		})();
		return this.shutdownPromise;
	}
}
