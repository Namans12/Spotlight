import { defineConfig } from "vitest/config";

// The service is plain Node with no DOM, so it must not inherit the root
// config's jsdom environment and React plugin; it has its own package and
// test run precisely so those stay out of its way.
export default defineConfig({
  test: {
    environment: "node",
  },
});
