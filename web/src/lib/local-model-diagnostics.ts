/** Diagnostics only: never request a second adapter, device, or model. */
interface RuntimeEnvironment {
	webgpu?: { device?: unknown };
	versions?: Readonly<Record<string, string>>;
}

interface DiagnosticDevice extends EventTarget {
	features: { has(name: string): boolean };
	limits: { maxBufferSize: number; maxStorageBufferBindingSize: number };
	adapterInfo?: { vendor?: string; architecture?: string; device?: string; description?: string };
	lost: Promise<{ reason: string; message: string }>;
}

interface GpuIssue {
	kind: string;
	message: string;
	at: string;
}

interface DeviceObservation {
	info: {
		shaderF16: boolean;
		maxBufferSize: number;
		maxStorageBufferBindingSize: number;
		adapter: DiagnosticDevice["adapterInfo"] | null;
	};
	firstError: GpuIssue | null;
	lost: GpuIssue | null;
	listeners: Set<(issue: GpuIssue) => void>;
}

const devices = new WeakMap<object, DeviceObservation>();

function observeDevice(device: DiagnosticDevice): DeviceObservation {
	const existing = devices.get(device);
	if (existing) return existing;
	const adapter = device.adapterInfo;
	const observation: DeviceObservation = {
		info: {
			shaderF16: device.features.has("shader-f16"),
			maxBufferSize: device.limits.maxBufferSize,
			maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
			adapter: adapter ? {
				vendor: adapter.vendor, architecture: adapter.architecture,
				device: adapter.device, description: adapter.description,
			} : null,
		},
		firstError: null,
		lost: null,
		listeners: new Set(),
	};
	// One listener per runtime device; do not replace ORT's onuncapturederror.
	device.addEventListener("uncapturederror", (event) => {
		const error = (event as Event & { error: { name?: string; message: string } }).error;
		const issue = { kind: error.name || error.constructor?.name || "WebGPUError", message: error.message, at: new Date().toISOString() };
		observation.firstError ??= issue;
		for (const listener of observation.listeners) listener(issue);
		console.error("[local-model] WebGPU error:", issue);
	});
	void device.lost.then((info) => {
		const issue = { kind: `device-lost:${info.reason}`, message: info.message, at: new Date().toISOString() };
		observation.lost = issue;
		for (const listener of observation.listeners) listener(issue);
		console.error("[local-model] WebGPU device lost:", issue);
	}).catch(() => { /* Diagnostic promises must not cause unhandled rejections. */ });
	devices.set(device, observation);
	console.info("[local-model] ONNX WebGPU device:", observation.info);
	return observation;
}

export function localModelDebugEnabled(): boolean {
	try {
		return typeof localStorage !== "undefined" && localStorage.getItem("keating:local-model-debug") === "1";
	} catch {
		return false;
	}
}

export function localModelErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** One report per load/generation; GPU events can be shared by concurrent runs. */
export class LocalModelDiagnostics {
	private observation: DeviceObservation | null = null;
	private unavailable = "ONNX has not exposed a WebGPU device.";
	private versions: Readonly<Record<string, string>> = {};
	private issues: GpuIssue[] = [];
	private issueCount = 0;
	private readonly startedAt = new Date().toISOString();
	private readonly collect = (issue: GpuIssue) => {
		this.issueCount += 1;
		// Preserve the first error even when the runtime floods the console.
		if (this.issues.length < 8) this.issues.push(issue);
	};
	inputTokens: number | null = null;
	maxNewTokens: number | null = null;
	transformersVersion: string | null = null;

	constructor(
		readonly modelId: string,
		readonly dtype: string | Record<string, string>,
		readonly phase: "loading" | "generation",
		readonly debug: boolean,
	) {}

	/** Call after session creation (or its failure), never to initialize a device. */
	async attach(runtime: RuntimeEnvironment, sessionCreated = true): Promise<void> {
		try {
			this.versions = { ...runtime.versions };
			// A getter can initialize a device. After failed session creation, read
			// only a published data property, never create one just for diagnostics.
			const exposed = sessionCreated ? runtime.webgpu?.device
				: runtime.webgpu && Object.getOwnPropertyDescriptor(runtime.webgpu, "device")?.value;
			const device = await exposed as DiagnosticDevice | undefined;
			if (!device) return;
			const observation = observeDevice(device);
			if (observation === this.observation) return;
			this.finish();
			this.observation = observation;
			observation.listeners.add(this.collect);
		} catch (error) {
			this.unavailable = `Could not inspect ONNX's device: ${localModelErrorMessage(error)}`;
		}
	}

	finish(): void {
		this.observation?.listeners.delete(this.collect);
	}

	/** No prompt, generated text, or tensor contents are collected here. */
	report(error: unknown) {
		return {
			modelId: this.modelId,
			dtype: this.dtype,
			phase: this.phase,
			startedAt: this.startedAt,
			failedAt: new Date().toISOString(),
			debug: this.debug,
			transformersVersion: this.transformersVersion,
			runtimeVersions: { ...this.versions },
			inputTokens: this.inputTokens,
			maxNewTokens: this.maxNewTokens,
			device: this.observation?.info ?? null,
			deviceUnavailableReason: this.observation ? null : this.unavailable,
			deviceLost: this.observation?.lost ?? null,
			firstErrorOnDevice: this.observation?.firstError ?? null,
			gpuErrorsDuringOperation: [...this.issues],
			gpuErrorCount: this.issueCount,
			runtimeError: localModelErrorMessage(error),
		};
	}

	error(error: unknown, summary: string): Error {
		const report = this.report(error);
		// JSON makes reports stable and directly copyable from DevTools.
		console.error("[local-model] diagnostics", JSON.stringify(report, null, 2));
		const gpuIssue = report.deviceLost ?? report.gpuErrorsDuringOperation[0];
		const details = gpuIssue
			? `WebGPU ${gpuIssue.kind}: ${gpuIssue.message}`
			: /webgpu|ortrun|gpu.?buffer|invalid buffer|mapasync/i.test(report.runtimeError)
				? "No earlier WebGPU error was captured. Enable browser-model debug logging, then reload and retry. Full diagnostic details are in the browser console."
				: "";
		return new Error(`${summary}\n\n${details ? `${details}\n` : ""}Runtime error: ${report.runtimeError}`, { cause: error });
	}
}
