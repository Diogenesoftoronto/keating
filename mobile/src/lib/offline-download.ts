import { OFFLINE_MODEL, validateRangeResponse, type OfflineState } from "./offline-model-contract";

export interface OfflineFiles {
  partialSize(): Promise<number>;
  ready(): Promise<boolean>;
  freeBytes(): Promise<number>;
  append(bytes: Uint8Array, offset: number): Promise<void>;
  verifyAndPromote(signal: AbortSignal): Promise<void>;
  removePartial(): Promise<void>;
  removeAll(): Promise<void>;
}

/** Bounded HTTP ranges persist progress in the file itself, including after process death. */
export class OfflineDownload {
  state: OfflineState = { phase: "checking", bytes: 0, freeBytes: 0, error: null };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private checking: Promise<void> | null = null;
  private deleting = false;
  constructor(private files: OfflineFiles, private fetcher: typeof fetch, private total = OFFLINE_MODEL.bytes as number,
    private chunkBytes = 4 * 1024 * 1024) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private publish(patch: Partial<OfflineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  refresh(): Promise<void> {
    if (this.running) return Promise.resolve();
    if (this.checking) return this.checking;
    this.checking = (async () => {
      try {
        const ready = await this.files.ready();
        const bytes = ready ? this.total : await this.files.partialSize();
        this.publish({ phase: ready ? "ready" : bytes ? "paused" : "absent", bytes,
          freeBytes: await this.files.freeBytes(), error: null });
      } catch (error) { this.fail(error); }
    })().finally(() => { this.checking = null; });
    return this.checking;
  }
  start(): Promise<void> {
    if (this.deleting) return Promise.reject(new Error("Wait for model removal to finish."));
    if (this.running) return this.running;
    const controller = new AbortController();
    this.controller = controller;
    this.running = this.download(controller.signal).finally(() => { this.running = null; this.controller = null; });
    return this.running;
  }
  async pause(): Promise<void> {
    this.controller?.abort();
    await this.running;
  }
  async remove(all = false): Promise<void> {
    if (this.deleting) return;
    this.deleting = true;
    try {
      await this.pause();
      await this.checking;
      if (all) await this.files.removeAll(); else await this.files.removePartial();
      await this.refresh();
    } finally { this.deleting = false; }
  }
  private fail(error: unknown) { this.publish({ phase: "error", error: error instanceof Error ? error.message : "Download failed. Try resuming it." }); }
  private async download(signal: AbortSignal): Promise<void> {
    try {
      await this.checking;
      if (await this.files.ready()) { this.publish({ phase: "ready", bytes: this.total }); return; }
      let offset = await this.files.partialSize();
      if (offset > this.total) throw new Error("This partial download is invalid. Cancel the download and start again.");
      const freeBytes = await this.files.freeBytes();
      this.publish({ bytes: offset, freeBytes, error: null });
      if (freeBytes < this.total - offset + 64 * 1024 * 1024) throw new Error("There is not enough storage. Free space on this device, then resume the download.");
      this.publish({ phase: "downloading" });
      while (offset < this.total) {
        if (signal.aborted) break;
        const end = Math.min(offset + this.chunkBytes, this.total) - 1;
        const response = await this.fetcher(OFFLINE_MODEL.url, {
          signal, headers: { Range: `bytes=${offset}-${end}`, "Accept-Encoding": "identity" },
        });
        try { validateRangeResponse(response.status, response.headers.get("content-range"), offset, end, this.total); }
        catch (error) { await response.body?.cancel(); throw error; }
        // Stream into a fixed buffer so even a dishonest Content-Range cannot allocate the whole model.
        const reader = response.body?.getReader();
        if (!reader) throw new Error("The download did not return a readable stream. Try again.");
        const bytes = new Uint8Array(end - offset + 1);
        let used = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (signal.aborted) break;
            if (used + value.byteLength > bytes.length) throw new Error("The download server sent too many bytes. Try resuming later.");
            bytes.set(value, used); used += value.byteLength;
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        if (signal.aborted) break;
        if (used !== bytes.length) throw new Error("The connection ended early. Resume the download to continue.");
        await this.files.append(bytes, offset);
        offset += bytes.length;
        this.publish({ bytes: offset });
      }
      if (signal.aborted) { this.publish({ phase: "paused" }); return; }
      this.publish({ phase: "verifying" });
      await this.files.verifyAndPromote(signal);
      this.publish({ phase: "ready", bytes: this.total, freeBytes: await this.files.freeBytes() });
    } catch (error) {
      if (signal.aborted) this.publish({ phase: "paused" }); else this.fail(error);
    }
  }
}
