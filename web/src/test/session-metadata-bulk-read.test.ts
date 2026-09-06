import { afterEach, beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBStorageBackend } from "../lib/cloud-storage-backend";

let original: PropertyDescriptor | undefined;
beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new IDBFactory(),
  });
});
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "indexedDB", original);
  else Reflect.deleteProperty(globalThis, "indexedDB");
});

test("bulk session reads preserve recency ordering, timestamp ties, and complete metadata", async () => {
  const backend = new IndexedDBStorageBackend({
    dbName: "session-bulk",
    version: 1,
    stores: [
      {
        name: "metadata",
        keyPath: "id",
        indices: [{ name: "modified", keyPath: "lastModified" }],
      },
    ],
  });
  const records = [
    { id: "z", lastModified: 2, preview: "fork", parentSessionId: "a" },
    { id: "a", lastModified: 2, preview: "source", parentSessionId: null },
    { id: "m", lastModified: 1, preview: "earlier", parentSessionId: null },
    { id: "b", lastModified: 3, preview: "latest", parentSessionId: null },
  ];
  for (const record of records)
    await backend.set("metadata", record.id, record);
  expect(await backend.getAllFromIndex("metadata", "modified", "asc")).toEqual([
    records[2],
    records[1],
    records[0],
    records[3],
  ]);
  expect(await backend.getAllFromIndex("metadata", "modified", "desc")).toEqual(
    [records[3], records[0], records[1], records[2]],
  );
  await backend.clear("metadata");
  expect(await backend.getAllFromIndex("metadata", "modified", "desc")).toEqual(
    [],
  );
});
