import type { JuliaEncodedRequest } from "./encoder.js";

/** Framework-neutral arrays identical to the vendor ONNX input layout. */
export function juliaTensorData(encoded: readonly JuliaEncodedRequest[]) {
  if (!encoded.length || encoded.length > 32) throw new Error("Julia batches require 1 to 32 decisions.");
  const batch = encoded.length, length = Math.ceil(Math.max(...encoded.map(row => row.ids.length)) / 8) * 8;
  const count = Math.max(...encoded.map(row => row.markers.length));
  const ids = new BigInt64Array(batch * length), attention = new BigInt64Array(batch * length);
  const markers = new BigInt64Array(batch * count), mask = new Uint8Array(batch * count), qtype = new BigInt64Array(batch);
  encoded.forEach((row, index) => {
    row.ids.forEach((id, token) => { ids[index * length + token] = BigInt(id); attention[index * length + token] = 1n; });
    row.markers.forEach((position, option) => { markers[index * count + option] = BigInt(position); mask[index * count + option] = 1; });
    qtype[index] = BigInt(row.qtype);
  });
  return { batch, length, count, ids, attention, markers, mask, qtype };
}
