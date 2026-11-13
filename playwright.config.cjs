const { defineConfig } = require("@playwright/test");
const path = require("node:path");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 90000,
  expect: { timeout: 5000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:52117",
    browserName: "chromium",
    channel: "msedge",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  reporter: "list",
  webServer: [
    { command: "node dist/server.js", cwd: path.join(__dirname, "backend"),
      env: { PORT: "42117", FRONTEND_ORIGIN: "http://127.0.0.1:52117" },
      url: "http://127.0.0.1:42117/api/health", reuseExistingServer: false, timeout: 30000 },
    { command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 52117 --strictPort", cwd: path.join(__dirname, "frontend"),
      env: { SEATLOCK_API_TARGET: "http://127.0.0.1:42117" },
      url: "http://127.0.0.1:52117", reuseExistingServer: false, timeout: 30000 }
  ]
});
