import { expect, test, type APIRequestContext } from "@playwright/test";

type ProjectFixture = {
  projectId: string;
  projectName: string;
  projectRoot: string;
  requirementId: string;
  requirementTitle: string;
  taskId: string;
  documentId: string;
};

type FixtureState = {
  alpha: ProjectFixture;
  beta: ProjectFixture;
};

type E2EResetResponse = {
  fixture: FixtureState;
  apiBaseUrl: string;
  webBaseUrl: string;
};

type E2EStateResponse = {
  fixture: FixtureState | null;
  runtime: {
    alpha: { ccbdRequests: number; tmuxCommands: number; ops: string[] };
    beta: { ccbdRequests: number; tmuxCommands: number; ops: string[] };
  };
  counters: {
    projectsListRequests: number;
  };
};

const apiBaseUrl = process.env.CCB_E2E_API_BASE_URL ?? "http://127.0.0.1:13030";
const webBaseUrl = process.env.CCB_E2E_BASE_URL ?? "http://127.0.0.1:15173";

let fixture: FixtureState;

async function resetFixture(request: APIRequestContext): Promise<FixtureState> {
  const response = await request.post(`${apiBaseUrl}/_e2e/reset`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as E2EResetResponse;
  return payload.fixture;
}

async function e2eState(request: APIRequestContext): Promise<E2EStateResponse> {
  const response = await request.get(`${apiBaseUrl}/_e2e/state`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as E2EStateResponse;
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }) => {
  fixture = await resetFixture(request);
});

test("binding a slot in one project leaves the other tab and runtime untouched", async ({ browser, request }) => {
  const alphaContext = await browser.newContext({ baseURL: webBaseUrl });
  const betaContext = await browser.newContext({ baseURL: webBaseUrl });
  const alphaPage = await alphaContext.newPage();
  const betaPage = await betaContext.newPage();

  try {
    await betaPage.goto(`/projects/${fixture.beta.projectId}/anchors`);
    await expect(betaPage.getByRole("heading", { name: "Slot 拓扑" })).toBeVisible();
    await expect(betaPage.getByTestId("slot-row").filter({ hasText: "slot-1" })).toContainText("空闲");

    await alphaPage.goto(`/projects/${fixture.alpha.projectId}/requirements/${fixture.alpha.requirementId}`);
    await expect(alphaPage.getByText("slot：未绑定 / state：idle")).toBeVisible();

    const resetRuntime = await request.post(`${apiBaseUrl}/_e2e/reset-runtime-records`);
    expect(resetRuntime.ok()).toBeTruthy();

    await alphaPage.getByLabel("Slot 运行位置").getByRole("button", { name: "绑定 slot", exact: true }).click();
    await expect(alphaPage.getByText("slot：slot-1 / state：bound")).toBeVisible();

    await expect(betaPage.getByTestId("slot-row").filter({ hasText: "slot-1" })).toContainText("空闲");
    await expect(betaPage.getByText(fixture.alpha.requirementTitle)).toHaveCount(0);

    const state = await e2eState(request);
    expect(state.runtime.alpha.ops).toContain("project_view");
    expect(state.runtime.alpha.tmuxCommands).toBeGreaterThan(0);
    expect(state.runtime.beta.ccbdRequests).toBe(0);
    expect(state.runtime.beta.tmuxCommands).toBe(0);
  } finally {
    await alphaContext.close();
    await betaContext.close();
  }
});

test("refresh keeps the project identity from the URL", async ({ page }) => {
  await page.goto(`/projects/${fixture.beta.projectId}/requirements`);
  await expect(page.getByText(fixture.beta.requirementTitle)).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(new RegExp(`/projects/${fixture.beta.projectId}/requirements$`));
  await expect(page.getByRole("button", { name: new RegExp(fixture.beta.projectName) }).first()).toBeVisible();
  await expect(page.getByText(fixture.beta.requirementTitle)).toBeVisible();
  await expect(page.getByText(fixture.alpha.requirementTitle)).toHaveCount(0);
});

test("silent 30s project refresh does not move the current tab to another project", async ({ page, request }) => {
  await page.clock.install();
  await page.goto(`/projects/${fixture.beta.projectId}/requirements`);
  await expect(page.getByText(fixture.beta.requirementTitle)).toBeVisible();

  const before = (await e2eState(request)).counters.projectsListRequests;
  const touch = await request.post(`${apiBaseUrl}/_e2e/touch-projects`);
  expect(touch.ok()).toBeTruthy();
  await page.clock.fastForward(31_000);

  await expect.poll(async () => (await e2eState(request)).counters.projectsListRequests).toBeGreaterThan(before);
  await expect(page).toHaveURL(new RegExp(`/projects/${fixture.beta.projectId}/requirements$`));
  await expect(page.getByText(fixture.beta.requirementTitle)).toBeVisible();
  await expect(page.getByText(fixture.alpha.requirementTitle)).toHaveCount(0);
});

test("legacy requirement task and document links redirect to their owning project", async ({ page }) => {
  await page.goto(`/requirements/${fixture.alpha.requirementId}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${fixture.alpha.projectId}/requirements/${fixture.alpha.requirementId}$`));

  await page.goto(`/tasks/${fixture.beta.taskId}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${fixture.beta.projectId}/tasks/${fixture.beta.taskId}$`));

  await page.goto(`/documents/${fixture.alpha.documentId}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${fixture.alpha.projectId}/documents/${fixture.alpha.documentId}$`));

  await page.goto("/requirements/e2e-missing-requirement");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("选择项目", { exact: true })).toBeVisible();
});

test("invalid projectId shows the explicit missing project page", async ({ page }) => {
  await page.goto("/projects/not-a-real-project/overview");

  await expect(page).toHaveURL(/\/projects\/not-a-real-project\/overview$/);
  await expect(page.getByText("项目不存在", { exact: true })).toBeVisible();
  await expect(page.getByText("URL 中的项目不存在或已被移除：not-a-real-project")).toBeVisible();
});

test("sidebar project switch changes the URL while preserving the current section", async ({ page }) => {
  await page.goto(`/projects/${fixture.alpha.projectId}/requirements`);
  await expect(page.getByText(fixture.alpha.requirementTitle)).toBeVisible();

  await page.getByRole("button", { name: new RegExp(fixture.alpha.projectName) }).first().click();
  await page.getByRole("button", { name: new RegExp(fixture.beta.projectName) }).last().click();

  await expect(page).toHaveURL(new RegExp(`/projects/${fixture.beta.projectId}/requirements$`));
  await expect(page.getByText(fixture.beta.requirementTitle)).toBeVisible();
  await expect(page.getByText(fixture.alpha.requirementTitle)).toHaveCount(0);
});
