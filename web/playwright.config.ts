import { defineConfig } from "@playwright/test";

// Real browser-to-service integration:
// * Local: Playwright starts the Vite dev server; it proxies /api to the
//   API already running at http://127.0.0.1:8000 (started separately,
//   e.g. via the API container or `uvicorn app.main:app`).
// * Docker `verify` service: WEB_URL/API_URL are provided, so Playwright
//   starts nothing and drives the running web/api containers over the
//   compose network (and /api is proxied by nginx inside the web service).
const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:5173";

const webServer = process.env.WEB_URL
  ? undefined
  : {
      command: "npm run dev -- --host 127.0.0.1 --port 5173",
      url: webUrl,
      reuseExistingServer: true,
      timeout: 60_000,
    };

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: webUrl,
  },
  webServer,
});
