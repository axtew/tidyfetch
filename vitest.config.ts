import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node 22 has fetch, Request, Response, Headers and AbortSignal.any built in.
    environment: "node",
    include: ["src/**/__tests__/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["src/**/__tests__/*.test-d.ts"],
    },
  },
});
