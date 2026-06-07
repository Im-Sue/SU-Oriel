# Playwright e2e

This suite starts a real Fastify server against `server/prisma/e2e.db`, then starts the Vite web app through the normal dev server proxy.

Run locally:

```bash
pnpm test:e2e:install
pnpm test:e2e
```

The harness exposes only test control endpoints under `/_e2e/*`. Production routes still come from `server/src/app.ts`, with pr6's per-project fake ccbd socket fixture injected for slot runtime isolation.
