import { checkSupport, createKernel, PtyError } from "unkernel/web";
import kernelUrl from "unkernel/alpine.wasm?url";
import type { LinuxLessonReply } from "./index";

self.onmessage = async ({ data: script }: MessageEvent<string>) => {
  let reply: LinuxLessonReply;
  try {
    const support = await checkSupport();
    if (!support.ok) throw new Error(`This browser cannot boot the guest. ${support.problems.join(" ")}`);
    // A RAM-only guest with the packaged initramfs, no network bridge or host mounts.
    const vm = await createKernel({ kernel: kernelUrl, memoryMiB: 64, memoryFallbackMiB: [], jit: false });
    try {
      const { stdout, stderr, exitCode, signal } = await vm.exec("/bin/sh", ["-c", script], {
        maxBuffer: 64 * 1024,
      });
      const status = exitCode ?? (signal === null ? null : 128 + signal);
      if (status === null) throw new Error("The Linux guest closed without an exit status.");
      reply = { result: { stdout, stderr, exitCode: status } };
    } finally {
      vm.stop();
    }
  } catch (error) {
    if (error instanceof PtyError && error.code === "ENOBUFS") {
      reply = { error: "Output exceeded the 64 KiB limit. Print fewer lines and run the lesson again." };
    } else {
      const message = error instanceof Error ? error.message : String(error);
      reply = { error: `Linux lab: ${message}` };
    }
  }
  self.postMessage(reply);
};
