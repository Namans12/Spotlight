import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Separate from vite.config.ts deliberately: the app config's VitePWA plugin
// has nothing to do with running tests and only adds startup cost and
// unrelated failure surface to every test run.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // The Pulse service is its own package with a node environment and its own
    // vitest run; under this jsdom config its tests would run in the wrong
    // environment and resolve dependencies from the wrong node_modules.
    exclude: [...configDefaults.exclude, "services/**"],
  },
});
