import type { FastifyReply, FastifyRequest } from "fastify";

export function getCcbApiToken(): string {
  return process.env.CCB_API_TOKEN ?? "dev-token";
}

export function requireCcbToken(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = request.headers["x-ccb-token"];
  const value = Array.isArray(token) ? token[0] : token;
  if (value === getCcbApiToken()) return true;
  reply.status(401);
  void reply.send({ error: "unauthorized", code: "ccb_token_required", hint: "Missing or invalid x-ccb-token header" });
  return false;
}
