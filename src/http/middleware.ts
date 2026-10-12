import type { IncomingMessage, ServerResponse } from "node:http";
import { EntityConflictError, EntityNotFoundError, type EntityRuntime, ValidationError } from "../application/entity-runtime";
import type { EntityRecord } from "../domain/entity";
import type { CrudAction, DomainRequest, PayloadPattern } from "../domain/request";
import type { DomainResponse } from "../domain/response";
import { BadRequestError, parseJson, readBody, sendEmpty, sendJson } from "../http";
import { createOpenApi } from "../openapi";
import { consoleHtml } from "../ui/console";

type HttpInput = { method: string; url: string; body?: string };
export type RequestContext = {
  request: IncomingMessage;
  response: ServerResponse;
  requestStartedAt?: number;
  httpInput?: HttpInput;
  domainRequest?: DomainRequest;
  domainResponse?: DomainResponse;
  requestRecord?: EntityRecord;
};
export type Middleware = (context: RequestContext, next: () => Promise<void>) => Promise<void>;

export function compose(middlewares: Middleware[]): (context: RequestContext) => Promise<void> {
  return async (context) => {
    let index = -1;
    const dispatch = async (position: number): Promise<void> => {
      if (position <= index) throw new Error("next() called more than once");
      index = position;
      await middlewares[position]?.(context, () => dispatch(position + 1));
    };
    await dispatch(0);
  };
}

/** The only middleware that understands Node's HTTP request/response objects. */
export function httpAdapterMiddleware(): Middleware {
  return async (context, next) => {
    try {
      context.requestStartedAt = Date.now();
      const method = context.request.method ?? "GET";
      context.httpInput = { method, url: context.request.url ?? "/", body: writesBody(method) ? await readBody(context.request) : undefined };
      await next();
    } catch (error) {
      context.domainResponse = errorResponse(error);
    }
    writeHttpResponse(context.response, context.domainResponse ?? { status: 500, body: { error: "Internal server error" } });
  };
}

/** Serves generated API documentation without coupling the domain runtime to HTTP. */
export function documentationMiddleware(runtime: EntityRuntime): Middleware {
  return async (context, next) => {
    const pathname = new URL(requireHttpInput(context).url, "http://localhost").pathname;
    if (pathname === "/openapi.json") {
      context.domainResponse = { status: 200, body: createOpenApi(runtime.definitions()) };
      return;
    }
    if (pathname === "/docs") {
      context.domainResponse = { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: swaggerHtml() };
      return;
    }
    if (pathname === "/console") {
      context.domainResponse = { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: consoleHtml() };
      return;
    }
    await next();
  };
}

/** Captures `/vN/:entity/:id?` or `/vN/:namespace/:entity/:id?` as a transport-neutral DomainRequest. */
export function restPatternMiddleware(runtime: EntityRuntime): Middleware {
  return async (context, next) => {
    const input = requireHttpInput(context);
    const route = matchRoute(input.url, runtime);
    if (!route) throw new EntityNotFoundError("Route not found");
    const action = actionFor(input.method, route.id);
    if (!action) throw new MethodNotAllowedError();
    context.domainRequest = { ...route, action };
    await next();
  };
}

/** Captures a single object or list payload, without passing an HTTP body into the domain. */
export function payloadPatternMiddleware(runtime: EntityRuntime): Middleware {
  return async (context, next) => {
    const domainRequest = context.domainRequest;
    if (!domainRequest || !requiresBody(domainRequest.action)) return next();
    if (domainRequest.action === "update" || domainRequest.action === "replace") {
      runtime.assertRecord(domainRequest.entityName, domainRequest.id, domainRequest.namespace);
    }
    const rawBody = requireHttpInput(context).body;
    const payload = capturePayload(rawBody === undefined ? undefined : parseJson(rawBody));
    if (domainRequest.action !== "create" && payload.kind === "many") throw new ValidationError("Only POST collection routes accept a list payload");
    domainRequest.payload = payload;
    if (domainRequest.action === "create" && payload.kind === "many") domainRequest.action = "bulkCreate";
    await next();
  };
}

/** Stores the normalized request in the system `requests` repository. */
export function requestRepositoryMiddleware(runtime: EntityRuntime): Middleware {
  return async (context, next) => {
    const request = context.domainRequest;
    if (!request) return next();
    const record = await runtime.execute({
      apiVersion: request.apiVersion,
      entityName: "requests",
      action: "create",
      payload: {
        kind: "one",
        value: {
          apiVersion: request.apiVersion,
          receivedAt: new Date(context.requestStartedAt ?? Date.now()).toISOString(),
          ...(request.namespace ? { namespace: request.namespace } : {}),
          entityName: request.entityName,
          action: request.action,
          ...(request.id ? { id: request.id } : {}),
          ...(request.payload ? { payload: request.payload } : {})
        }
      }
    });
    context.requestRecord = record as EntityRecord;
    await next();
  };
}

/** Stores every matched response under the same id as its normalized request. */
export function responseRepositoryMiddleware(runtime: EntityRuntime): Middleware {
  return async (context, next) => {
    try {
      await next();
    } catch (error) {
      context.domainResponse = errorResponse(error);
    }
    const response = context.domainResponse ?? { status: 500, body: { error: "Internal server error" } };
    const completedAt = new Date();
    await runtime.execute({
      apiVersion: context.domainRequest?.apiVersion ?? "v1",
      entityName: "responses",
      action: "create",
      payload: {
        kind: "one",
        value: {
          status: response.status,
          completedAt: completedAt.toISOString(),
          durationMs: Math.max(0, completedAt.getTime() - (context.requestStartedAt ?? completedAt.getTime())),
          ...(response.body === undefined ? {} : { body: response.body })
        }
      }
    }, context.requestRecord?.id ? { createId: context.requestRecord.id } : {});
  };
}

/** Executes domain CRUD and returns a normalized response rather than writing HTTP. */
export function entityLifecycleMiddleware(runtime: EntityRuntime): Middleware {
  return async (context) => {
    const request = context.domainRequest;
    if (!request) return;
    const result = await runtime.execute(request);
    if (request.action === "delete") return setResponse(context, 204);
    if (request.action === "bulkCreate") return setResponse(context, 201, { items: result });
    setResponse(context, request.action === "create" ? 201 : 200, result);
  };
}

function setResponse(context: RequestContext, status: number, body?: unknown): void {
  context.domainResponse = { status, body };
}

function requireHttpInput(context: RequestContext): HttpInput {
  if (!context.httpInput) throw new Error("HTTP adapter has not run");
  return context.httpInput;
}

function errorResponse(error: unknown): DomainResponse {
  if (error instanceof EntityNotFoundError) return { status: 404, body: { error: error.message } };
  if (error instanceof EntityConflictError) return { status: 409, body: { error: error.message } };
  if (error instanceof MethodNotAllowedError) return { status: 405, body: { error: error.message } };
  if (error instanceof ValidationError || error instanceof BadRequestError) return { status: 400, body: { error: error.message } };
  return { status: 500, body: { error: "Internal server error" } };
}

function writeHttpResponse(response: ServerResponse, domain: DomainResponse): void {
  for (const [name, value] of Object.entries(domain.headers ?? {})) response.setHeader(name, value);
  if (domain.body === undefined) return sendEmpty(response, domain.status);
  if (typeof domain.body === "string" && response.getHeader("content-type")?.toString().startsWith("text/")) {
    response.statusCode = domain.status;
    response.end(domain.body);
    return;
  }
  sendJson(response, domain.status, domain.body);
}

function matchRoute(url: string, runtime: EntityRuntime): Pick<DomainRequest, "apiVersion" | "namespace" | "entityName" | "id"> | undefined {
  const pathname = new URL(url, "http://localhost").pathname;
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [apiVersion, ...parts] = segments;
  if (!apiVersion || !/^v\d+$/.test(apiVersion)) return undefined;
  if (parts.length === 1 && runtime.has(parts[0])) return { apiVersion, entityName: parts[0] };
  if (parts.length === 2) {
    if (runtime.has(parts[0])) return { apiVersion, entityName: parts[0], id: parts[1] };
    if (runtime.has(parts[1], parts[0])) return { apiVersion, namespace: parts[0], entityName: parts[1] };
  }
  if (parts.length === 3 && runtime.has(parts[1], parts[0])) {
    return { apiVersion, namespace: parts[0], entityName: parts[1], id: parts[2] };
  }
  return undefined;
}

function actionFor(method: string, id?: string): CrudAction | undefined {
  if (!id && method === "GET") return "list";
  if (!id && method === "POST") return "create";
  if (id && method === "GET") return "get";
  if (id && method === "PUT") return "replace";
  if (id && method === "PATCH") return "update";
  if (id && method === "DELETE") return "delete";
}

function writesBody(method: string): boolean { return method === "POST" || method === "PUT" || method === "PATCH"; }
function requiresBody(action: CrudAction): boolean { return action === "create" || action === "replace" || action === "update"; }
function capturePayload(body: unknown): PayloadPattern { return Array.isArray(body) ? { kind: "many", values: body } : { kind: "one", value: body }; }
class MethodNotAllowedError extends Error { constructor() { super("Method not allowed"); } }

function swaggerHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exensial API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui'})</script></body></html>`;
}
