import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
/// <reference types="vitest/config" />
import { defineConfig } from "vite";

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
			"@loopwire/types": new URL("../../packages/types/src", import.meta.url)
				.pathname,
		},
	},
	test: {
		environment: "node",
		setupFiles: ["./src/test-setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov", "html"],
			reportsDirectory: "./coverage",
			thresholds: {
				lines: 1,
				functions: 1,
				branches: 1,
				statements: 1,
			},
		},
	},
});
