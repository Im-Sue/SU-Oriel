import { buildApp } from "./app.js";
import { prisma } from "./db/prisma.js";
import { sharedPtyManager } from "./modules/ai-cli/ai-cli.pty.js";
import { startProjectionServices, type ProjectionServicesHandle } from "./server-bootstrap.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3030);
const host = process.env.HOST ?? "127.0.0.1";
let projectionServices: ProjectionServicesHandle | null = null;
let shutdownPromise: Promise<void> | null = null;

async function start(): Promise<void> {
  try {
    projectionServices = await startProjectionServices({ logger: app.log });
    await app.listen({ port, host });
    app.log.info(`CCB Console 服务已启动：http://${host}:${port}`);
  } catch (error) {
    app.log.error(error, "CCB Console 服务启动失败");
    try {
      await projectionServices?.stop();
    } catch (shutdownError) {
      app.log.error(shutdownError, "后台派发服务关闭失败");
    }
    await prisma.$disconnect();
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  try {
    sharedPtyManager.killAll();
  } catch {
    // ignore
  }
  try {
    await projectionServices?.stop();
  } catch (error) {
    app.log.error(error, "后台派发服务关闭失败");
  } finally {
    projectionServices = null;
  }
  try {
    await app.close();
  } catch (error) {
    app.log.error(error, "CCB Console 服务关闭失败");
  }
  await prisma.$disconnect();
}

function requestShutdown(): Promise<void> {
  shutdownPromise ??= shutdown();
  return shutdownPromise;
}

process.on("SIGINT", () => {
  void requestShutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void requestShutdown().finally(() => process.exit(0));
});

void start();
