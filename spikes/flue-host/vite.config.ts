import { flue } from "@flue/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    flue({
      // The host registers a deterministic faux provider itself. Shipping no
      // built-ins proves that the integration does not fall through to a
      // network provider or ambient API key.
      providers: [],
    }),
  ],
});
