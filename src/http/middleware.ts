import type { IncomingMessage, ServerResponse } from "node:http";
import { EntityConflictError, EntityNotFoundError, type EntityRuntime, ValidationError } from "../application/entity-runtime";
import { compileExensialFilter } from "../application/exensial-query";
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
export function documentationMiddleware(runtime: EntityRuntime, options: { exensialQuery?: boolean } = {}): Middleware {
  return async (context, next) => {
    const pathname = new URL(requireHttpInput(context).url, "http://localhost").pathname;
    if (pathname === "/openapi.json") {
      context.domainResponse = { status: 200, body: createOpenApi(runtime.definitions(), options) };
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

/** Optional OData-like read engine. Its public availability is advertised in OpenAPI. */
export function exensialQueryMiddleware(runtime: EntityRuntime, enabled = true): Middleware {
  return async (context, next) => {
    if (!enabled) return next();
    const input = requireHttpInput(context);
    const route = matchExensialQueryRoute(input.url, runtime);
    if (!route) return next();
    if (input.method !== "GET") throw new MethodNotAllowedError();
    const url = new URL(input.url, "http://localhost");
    const definition = runtime.definitions().find((item) => item.name === route.entityName && item.context?.namespace === route.namespace);
    if (!definition) throw new EntityNotFoundError("Entity not found");
    const skip = queryInteger(url.searchParams.get("$skip"), "$skip", 0, 0, 100_000);
    const take = queryInteger(url.searchParams.get("$top"), "$top", 25, 1, 100);
    const result = runtime.query(route.entityName, compileExensialFilter(url.searchParams.get("$filter"), definition), { skip, take }, route.namespace);
    context.domainResponse = {
      status: 200,
      headers: { "X-Total-Count": String(result.total), "X-Query-Skip": String(skip), "X-Query-Top": String(take) },
      body: result.items
    };
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
    context.domainRequest = { ...route, action, ...(action === "list" ? { pagination: pagination(input.url) } : {}) };
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
    if (request.action === "list") return setResponse(context, 200, result, paginationHeaders(context, runtime, request));
    setResponse(context, request.action === "create" ? 201 : 200, result);
  };
}

function setResponse(context: RequestContext, status: number, body?: unknown, headers?: Record<string, string>): void {
  context.domainResponse = { status, body, headers };
}

function pagination(url: string): { page: number; perPage: number } {
  const query = new URL(url, "http://localhost").searchParams;
  const number = (name: string, fallback: number) => { const value = Number(query.get(name) ?? fallback); if (!Number.isInteger(value) || value < 1 || value > 100) throw new ValidationError(`${name} must be an integer between 1 and 100`); return value; };
  return { page: number("page", 1), perPage: number("perPage", 25) };
}

function paginationHeaders(context: RequestContext, runtime: EntityRuntime, request: DomainRequest): Record<string, string> {
  const { page, perPage } = request.pagination!;
  const total = runtime.count(request.entityName, request.namespace);
  const url = new URL(requireHttpInput(context).url, "http://localhost");
  const link = (target: number, rel: string) => { const next = new URL(url); next.searchParams.set("page", String(target)); next.searchParams.set("perPage", String(perPage)); return `<${next.pathname}${next.search}>; rel="${rel}"`; };
  const links = [page > 1 ? link(1, "first") : "", page > 1 ? link(page - 1, "prev") : "", page * perPage < total ? link(page + 1, "next") : "", total ? link(Math.ceil(total / perPage), "last") : ""].filter(Boolean);
  return { "X-Total-Count": String(total), "X-Page": String(page), "X-Per-Page": String(perPage), ...(links.length ? { Link: links.join(", ") } : {}) };
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

function matchExensialQueryRoute(url: string, runtime: EntityRuntime): Pick<DomainRequest, "apiVersion" | "namespace" | "entityName"> | undefined {
  const segments = new URL(url, "http://localhost").pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [apiVersion, engine, capability, nameOrNamespace, maybeName, extra] = segments;
  if (!apiVersion || !/^v\d+$/.test(apiVersion) || engine !== "query" || capability !== "exensial" || extra) return undefined;
  if (maybeName && runtime.has(maybeName, nameOrNamespace)) return { apiVersion, namespace: nameOrNamespace, entityName: maybeName };
  if (!maybeName && runtime.has(nameOrNamespace)) return { apiVersion, entityName: nameOrNamespace };
  return undefined;
}

function queryInteger(raw: string | null, name: string, fallback: number, min: number, max: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new ValidationError(`${name} must be an integer between ${min} and ${max}`);
  return value;
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
