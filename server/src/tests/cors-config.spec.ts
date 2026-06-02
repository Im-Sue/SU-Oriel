import assert from "node:assert/strict";

import { afterEach, test } from "vitest";

import { buildApp } from "../app.js";

async function cors(origin: string) {
  const app = buildApp({ enableFileWatcher: false });
  const response = await app.inject({ method: "GET", url: "/api/health", headers: { origin } });
  await app.close(); return response.headers["access-control-allow-origin"];
}
afterEach(() => { delete process.env.CCB_CORS_ALLOWED_ORIGINS; });

test("CORS allows the local Vite origin", async () => {
  assert.equal(await cors("http://localhost:5173"), "http://localhost:5173");
});

test("CORS rejects non-whitelisted origins and honors env overrides", async () => {
  process.env.CCB_CORS_ALLOWED_ORIGINS = "http://console.test";
  assert.equal(await cors("http://console.test"), "http://console.test");
  assert.equal(await cors("http://localhost:5173"), undefined);
});
