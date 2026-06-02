import assert from "node:assert/strict";

import { test } from "vitest";

import { buildApp } from "../../app.js";

test("legacy materialize mutation endpoints are not registered", async () => {
  const app = buildApp({ enableFileWatcher: false });
  try {
    const requirementResponse = await app.inject({
      method: "POST",
      url: "/api/requirements/req-1/materialize-requirement",
      payload: {}
    });
    const epicResponse = await app.inject({
      method: "POST",
      url: "/api/tasks/task-1/materialize-as-plan",
      payload: {}
    });

    assert.equal(requirementResponse.statusCode, 404, requirementResponse.body);
    assert.equal(epicResponse.statusCode, 404, epicResponse.body);
  } finally {
    await app.close();
  }
});
