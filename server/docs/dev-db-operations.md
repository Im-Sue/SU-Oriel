# dev.db / test.db Operations

This note covers only this repo's SQLite operating rules. It is not a Prisma
migration guide.

## Database Roles

- `apps/ccb-console/server/prisma/dev.db` is the local development database.
- `apps/ccb-console/server/prisma/test.db` is the isolated Vitest database.
- `scripts/setup-test-db.ts` is the test authority for this split. Since commit
  `4a17445` (2026-05-10), Vitest global setup sets
  `DATABASE_URL=file:<server>/prisma/test.db` and `VITEST=1`.
- `src/db/prisma.ts` also detects Vitest signals (`VITEST`,
  `VITEST_POOL_ID`, `VITEST_WORKER_ID`, `NODE_ENV=test`) and forces Prisma to
  use `test.db`, even if an external `DATABASE_URL` points elsewhere.
- When `dev.db` exists, `setup-test-db.ts` checkpoints and copies it to
  `test.db`, then clears data in `test.db` while preserving schema. Test
  `deleteMany()` calls therefore do not clear `dev.db`.
- `scripts/ensure_dev_db.py` prepares `dev.db` with `CREATE TABLE IF NOT EXISTS`
  and does not reset existing data.

## Safe Commands

These commands are safe for `dev.db` data under the current repo scripts:

```bash
pnpm --filter ccb-console-server db:prepare
pnpm --filter ccb-console-server prisma:generate
pnpm --filter ccb-console-server test
pnpm dev:server
```

Notes:

- `db:prepare` creates missing tables/indexes only; it is not a destructive
  migration path.
- `pnpm --filter ccb-console-server test` runs `db:prepare`, generates Prisma
  client, then runs Vitest against `test.db`.
- `pnpm dev:server` starts the server against the development database unless
  the caller explicitly overrides `DATABASE_URL`.

## Dangerous Commands

These commands can reset or drop data from the database named by
`DATABASE_URL`; with the default server setup, that is usually `dev.db`:

```bash
pnpm --filter ccb-console-server prisma:migrate
pnpm --filter ccb-console-server prisma:push
pnpm --filter ccb-console-server exec prisma migrate dev --schema prisma/schema.prisma
pnpm --filter ccb-console-server exec prisma db push --schema prisma/schema.prisma --accept-data-loss
```

Treat these as data-destructive operations when schema drift exists or Prisma
asks to reset SQLite. For migration smoke tests, prefer a disposable database by
setting `DATABASE_URL=file:/tmp/ccb-migration-smoke.db` for that command.

## Protect Backfill Data

Before manual migration, schema repair, or `db push --accept-data-loss`, back up
`dev.db` and any WAL sidecars. Avoid copying while the dev server is writing.

```bash
python3 - <<'PY'
import sqlite3
c = sqlite3.connect("apps/ccb-console/server/prisma/dev.db")
c.execute("PRAGMA wal_checkpoint(FULL)")
c.close()
PY

stamp=$(date +%Y%m%d-%H%M%S)
cp apps/ccb-console/server/prisma/dev.db "/tmp/ccb-dev-${stamp}.db"
for suffix in -wal -shm; do
  src="apps/ccb-console/server/prisma/dev.db${suffix}"
  [ -e "$src" ] && cp "$src" "/tmp/ccb-dev-${stamp}.db${suffix}"
done
```

Backfill data that is only in `dev.db` should be exported or materialized before
a destructive migration. For Requirement records, `docs/02_需求设计/**` is the
durable source when markdown already exists; DB-only rows should be exported
first with the existing dry-run/apply script:

```bash
pnpm --filter ccb-console-server tsx scripts/export-db-requirements-to-docs.ts --project=<projectId>
pnpm --filter ccb-console-server tsx scripts/export-db-requirements-to-docs.ts --project=<projectId> --apply
```

## Rehydrate

Rehydrate `dev.db` after a manual reset, branch switch with schema drift, or any
operation that removed backfilled/materialized rows while docs still represent
the desired project state.

Use the current manual flow; this repo does not yet provide a `db:rehydrate`
script:

```bash
pnpm --filter ccb-console-server db:prepare
pnpm --filter ccb-console-server prisma:generate
pnpm --filter ccb-console-server tsx scripts/verify-task-projection.ts --scan --project <projectId>
pnpm --filter ccb-console-server tsx src/maintenance/backfill-requirement-generated-task-id.ts
pnpm --filter ccb-console-server tsx src/maintenance/backfill-requirement-generated-task-id.ts --apply
pnpm --filter ccb-console-server tsx src/maintenance/backfill-requirement-generated-task-id.ts --materialize-single-carriers
pnpm --filter ccb-console-server tsx src/maintenance/backfill-requirement-generated-task-id.ts --materialize-single-carriers --apply
pnpm --filter ccb-console-server tsx src/maintenance/backfill-requirement-generated-task-id.ts --materialize-multi-carriers-followup
pnpm --filter ccb-console-server tsx src/maintenance/backfill-requirement-generated-task-id.ts --materialize-multi-carriers-followup --apply
```

Run dry-run commands first, inspect counts and skipped rows, then run the matching
`--apply` command only for the intended project state.
