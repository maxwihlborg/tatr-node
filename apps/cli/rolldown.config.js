import { defineConfig } from "rolldown";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  input: "./src/index.ts",
  platform: "node",
  transform: {
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
  },
  output: {
    dir: "./dist",
    cleanDir: true,
    format: "esm",
    minify: true,
  },
});
