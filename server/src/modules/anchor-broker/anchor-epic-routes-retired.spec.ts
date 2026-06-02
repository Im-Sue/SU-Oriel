import assert from "node:assert/strict";
import { test } from "vitest";

import { buildApp } from "../../app.js";

test("/api/epics/:epicId/anchor/* routes are retired with 410", async () => {
  const app = buildApp({ enableFileWatcher: false });
  try {
    for (const request of [
      { method: "GET", url: "/api/epics/epic-1/anchor/preview" },
      { method: "POST", url: "/api/epics/epic-1/anchor/start" },
      { method: "POST", url: "/api/epics/epic-1/anchor/stop" },
      { method: "POST", url: "/api/epics/epic-1/anchor/reset" }
    ] as const) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 410);
      assert.match(response.json().message, /Epic anchor 入口已退役/);
    }
  } finally {
    await app.close();
  }
});
