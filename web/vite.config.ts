import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the browser calls /api/* and Vite proxies to the real API
// (http://localhost:8000 by default, overridable via API_ORIGIN).
// In production nginx performs the same proxy inside Docker.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_ORIGIN ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
