import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import typegpu from "unplugin-typegpu/vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    target: "esnext",
  },
  plugins: [typegpu()],
});
