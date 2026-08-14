import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/dashboard-[hash].js",
        assetFileNames: "assets/dashboard-[hash][extname]"
      }
    }
  }
});
