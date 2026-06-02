import type { FastifyRequest } from "fastify";

const LOCAL_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * AI CLI 接口必须仅本机可达——它能拉起任意预设进程，禁止远程触发。
 * 部署到远程时如要放开，应替换为基于 token 的鉴权层（设计文档 §11）。
 */
export function assertLocalRequest(request: FastifyRequest): void {
  const ip = request.ip ?? "";
  if (!LOCAL_IPS.has(ip)) {
    const error = new Error("AI CLI 仅允许本机访问") as Error & { statusCode?: number; code?: string };
    error.statusCode = 403;
    error.code = "WS_UNAUTHORIZED";
    throw error;
  }
}
