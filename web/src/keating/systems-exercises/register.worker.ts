import { checkWasmRegister } from "./register";

self.onmessage = async (event: MessageEvent<string>) => {
  try {
    const value = await checkWasmRegister(event.data);
    self.postMessage({ ok: true, value });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
