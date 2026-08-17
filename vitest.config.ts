import { defineConfig } from "vitest/config";
import path from "path";

// Mirrors tsconfig.json's "paths" -- Metro/Expo resolve the "@/*" alias at
// build time via babel, which vitest (a plain Vite/Node runner) doesn't
// pick up on its own.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname),
    },
  },
  // Metro/babel use the automatic JSX runtime (no explicit React import
  // needed per file); esbuild needs the same told explicitly, or .tsx files
  // outside this config's control (e.g. components under test, not test
  // files themselves) fail with "React is not defined".
  esbuild: {
    jsx: "automatic",
  },
});
