import { defineConfig } from "prisma/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fallbackUrl = `file:${resolve(here, "prisma/dev.db").replace(/\\/g, "/")}`;
process.env.DATABASE_URL ??= fallbackUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    // Prisma CLI 把相对路径基于 schema 目录解析；统一改成绝对路径，避免
    // db push 写到 server/prisma/prisma/dev.db 而 runtime 连 server/prisma/dev.db。
    url: process.env.DATABASE_URL ?? fallbackUrl
  }
});
