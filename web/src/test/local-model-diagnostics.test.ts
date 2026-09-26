import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { LocalModelDiagnostics } from "../lib/local-model-diagnostics";
import { BROWSER_MODELS, classifyLocalModelError } from "../stores/local-model";

const spec = BROWSER_MODELS[0]!;
const readbackError = "failed to call OrtRun(). /providers/webgpu/buffer_manager.cc:629 Failed to download data from buffer. mapAsync: [Invalid Buffer (unlabeled)] is invalid due to a previous error.";

function fakeDevice() {
	const target = new EventTarget();
	let lose!: (info: { reason: string; message: string }) => void;
	return Object.assign(target, {
		features: new Set(["shader-f16"]),
		limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 2147483644 },
		adapterInfo: { vendor: "intel", description: "Iris Xe" },
		lost: new Promise<{ reason: string; message: string }>((resolve) => { lose = resolve; }),
		lose: (reason: string, message: string) => lose({ reason, message }),
		raise: (message: string) => {
			const event = new Event("uncapturederror");
			Object.assign(event, { error: { name: "GPUValidationError", message } });
			target.dispatchEvent(event);
		},
	});
}

const spies: Array<{ mockRestore(): void }> = [];
function quietConsole() {
	spies.push(spyOn(console, "error").mockImplementation(() => {}));
	spies.push(spyOn(console, "info").mockImplementation(() => {}));
}
afterEach(() => { for (const spy of spies.splice(0)) spy.mockRestore(); });

describe("browser model error classification", () => {
	it("identifies the reported readback failure without asserting unsupported hardware", () => {
		const result = classifyLocalModelError(readbackError, spec);
		expect(result).toContain("read inference data back");
		expect(result).not.toContain("WebGPU is not supported");
	});

	it("keeps allocation, limits and device loss ahead of generic WebGPU errors", () => {
		expect(classifyLocalModelError("WebGPU out of memory", spec)).toContain("memory allocation failed");
		expect(classifyLocalModelError("WebGPU size exceeds maxBufferSize", spec)).toContain("buffer-size or binding limit");
		expect(classifyLocalModelError("WebGPU device was lost", spec)).toContain("GPU device was lost");
	});

	it("does not diagnose sub-4-bit weights or missing f16 from kernel names alone", () => {
		expect(classifyLocalModelError("WebGPU MatMulNBits shader compilation failed", spec)).toContain("WebGPU execution");
		expect(classifyLocalModelError("WebGPU shader-f16 pipeline validation failed", spec)).toContain("WebGPU execution");
		expect(classifyLocalModelError("MatMulNBits bits must be 4 or 8", spec)).toContain("below 4 bits");
	});
});

describe("actual runtime device diagnostics", () => {
	it("retains the first GPU error through a flood and preserves the original exception", async () => {
		quietConsole();
		const device = fakeDevice();
		const diagnostics = new LocalModelDiagnostics(spec.id, spec.dtype, "generation", false);
		await diagnostics.attach({ webgpu: { device: Promise.resolve(device) }, versions: { web: "1.29.0" } });
		diagnostics.inputTokens = 12;
		diagnostics.maxNewTokens = 8;
		device.raise("Buffer size 3000000000 exceeds maxBufferSize 2147483648");
		for (let i = 0; i < 20; i++) device.raise("Invalid buffer");
		const original = new Error(readbackError);
		const error = diagnostics.error(original, classifyLocalModelError(original.message, spec));
		const report = diagnostics.report(original);
		expect(error.cause).toBe(original);
		expect(error.message).toContain("Buffer size 3000000000");
		expect(error.message).toContain(readbackError);
		expect(report.device?.maxBufferSize).toBe(2147483648);
		expect(report.device?.shaderF16).toBe(true);
		expect(report.runtimeVersions.web).toBe("1.29.0");
		expect(report.inputTokens).toBe(12);
		expect(report.gpuErrorCount).toBe(21);
		expect(report.gpuErrorsDuringOperation).toHaveLength(8);
		diagnostics.finish();
	});

	it("shares one device listener and keeps operation errors separate", async () => {
		quietConsole();
		const device = fakeDevice();
		const listen = spyOn(device, "addEventListener");
		spies.push(listen);
		const first = new LocalModelDiagnostics(spec.id, spec.dtype, "loading", false);
		await first.attach({ webgpu: { device } });
		await first.attach({ webgpu: { device } });
		device.raise("Earlier session error");
		first.finish();
		const next = new LocalModelDiagnostics(spec.id, spec.dtype, "generation", false);
		await next.attach({ webgpu: { device } });
		device.raise("Current generation error");
		expect(listen).toHaveBeenCalledTimes(1);
		expect(first.report("failed").gpuErrorCount).toBe(1);
		expect(next.report("failed").gpuErrorsDuringOperation[0]?.message).toBe("Current generation error");
		expect(next.report("failed").firstErrorOnDevice?.message).toBe("Earlier session error");
		next.finish();
	});

	it("remembers device loss between operations without misreporting a new device", async () => {
		quietConsole();
		const device = fakeDevice();
		const first = new LocalModelDiagnostics(spec.id, spec.dtype, "loading", false);
		await first.attach({ webgpu: { device } });
		first.finish();
		device.lose("unknown", "GPU reset by driver");
		await Promise.resolve();
		const next = new LocalModelDiagnostics(spec.id, spec.dtype, "generation", false);
		await next.attach({ webgpu: { device } });
		expect(next.error(new Error(readbackError), "Generation failed").message).toContain("GPU reset by driver");
		next.finish();
		const replacement = new LocalModelDiagnostics(spec.id, spec.dtype, "loading", false);
		await replacement.attach({ webgpu: { device: fakeDevice() } });
		expect(replacement.report("failed").deviceLost).toBeNull();
		replacement.finish();
	});

	it("survives missing and rejected device inspection", async () => {
		quietConsole();
		const diagnostics = new LocalModelDiagnostics(spec.id, spec.dtype, "loading", false);
		await diagnostics.attach({});
		expect(diagnostics.report("failed").device).toBeNull();
		await diagnostics.attach({ webgpu: { device: Promise.reject(new Error("Device unavailable")) } });
		expect(diagnostics.report("failed").deviceUnavailableReason).toContain("Device unavailable");
		expect(diagnostics.error(new Error(readbackError), "Readback failed").message).toContain("No earlier WebGPU error was captured");
	});

	it("never invokes a device-creating getter after session creation failed", async () => {
		let reads = 0;
		const diagnostics = new LocalModelDiagnostics(spec.id, spec.dtype, "loading", false);
		await diagnostics.attach({ webgpu: { get device() { reads++; throw new Error("Must not initialize"); } } }, false);
		expect(reads).toBe(0);
		expect(diagnostics.report("failed").device).toBeNull();
	});
});
