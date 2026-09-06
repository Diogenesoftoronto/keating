/** Coalesce bursts of storage notifications and only publish the freshest read. */
export function createSessionLibraryRefresh<T>(options: {
  read: () => Promise<T>;
  receive: (value: T) => void;
  fail: (error: unknown) => void;
}) {
  let pending: Promise<void> | undefined;
  let dirty = false;
  let disposed = false;
  return {
    request(): Promise<void> {
      if (disposed) return Promise.resolve();
      dirty = true;
      if (pending) return pending;
      pending = Promise.resolve().then(async () => {
        try {
          while (dirty && !disposed) {
            dirty = false;
            try {
              const value = await options.read();
              if (!disposed && !dirty) options.receive(value);
            } catch (error) {
              if (!disposed && !dirty) options.fail(error);
            }
          }
        } finally {
          pending = undefined;
        }
      });
      return pending;
    },
    dispose() {
      disposed = true;
      dirty = false;
    },
  };
}
