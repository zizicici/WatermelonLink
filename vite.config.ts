import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname, "web"),
  build: {
    outDir: resolve(import.meta.dirname, "dist/web"),
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4173",
      "/ws": {
        target: "ws://127.0.0.1:4173",
        ws: true
      }
    }
  }
});
