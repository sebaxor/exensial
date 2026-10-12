import type { IncomingMessage, ServerResponse } from "node:http";

export async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

export function parseJson(body: string): unknown {
  try { return JSON.parse(body); } catch { throw new BadRequestError("Invalid JSON body"); }
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  return parseJson(await readBody(request));
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status);
  response.end();
}

export class BadRequestError extends Error {}
