import { defineConfig } from "prisma/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Prisma CLI 把相对路径基于 schema 文件的目录解析（而不是 cwd），
// 否则 `prisma db push` 会写到 server/prisma/prisma/dev.db，与 runtime 用的
// server/prisma/dev.db 不一致。统一用绝对路径杜绝该坑。
const here = dirname(fileURLToPath(import.meta.url));
const fallbackUrl = `file:${resolve(here, "prisma/dev.db").replace(/\\/g, "/")}`;
process.env.DATABASE_URL ??= fallbackUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env.DATABASE_URL ?? fallbackUrl
  }
});
