import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// The backend serves no CORS headers (helmet only), so the dev server proxies
// every /api request to the Express process instead of calling it cross-origin.
const BACKEND = "http://localhost:3000";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "src"),
        },
    },
    server: {
        port: 5173,
        proxy: {
            "/api": {
                target: BACKEND,
                changeOrigin: true,
                rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
            },
        },
    },
});
