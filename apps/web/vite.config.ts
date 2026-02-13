import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:9400",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@loopwire/types": new URL(
        "../../packages/types/src",
        import.meta.url,
      ).pathname,
    },
  },
});
