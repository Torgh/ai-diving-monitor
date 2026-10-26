import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The phone app: a static React build that Capacitor wraps into an Android app (see capacitor.config.ts).
export default defineConfig({
  root: here("./"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: [
      // The shared components link with next/link; on the phone a plain link to the screen after "#".
      { find: /^next\/link$/, replacement: here("./src/Link.tsx") },
      // Shares lib/, the components and the styles with the desktop app, under the same "@/..." imports.
      { find: "@", replacement: here("../") },
    ],
  },
  build: {
    outDir: here("./dist"),
    emptyOutDir: true,
    target: "es2022",
    // React, the Markdown renderer and lib/ in one ~520 kB file, read from the phone rather than
    // downloaded. Warn above that, so a really oversized chunk still stands out.
    chunkSizeWarningLimit: 700,
  },
  // Reachable from the emulator (10.0.2.2) and phones on the same Wi-Fi for live reload.
  server: { host: true, port: 5173, strictPort: true },
});
