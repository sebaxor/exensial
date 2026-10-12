import type { IncomingMessage, ServerResponse } from "node:http";
import { EntityConflictError, EntityNotFoundError, type EntityRuntime, ValidationError } from "../application/entity-runtime";
import type { CrudAction, DomainRequest, PayloadPattern } from "../domain/request";
import { BadRequestError, readJson, sendEmpty, sendJson } from "../http";

export type RequestContext = { request: IncomingMessage; response: ServerResponse; domainRequest?: DomainRequest };
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

/** Converts errors from any later middleware into the public HTTP error contract. */
export function errorMiddleware(): Middleware {
  return async (context, next) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof EntityNotFoundError) return sendJson(context.response, 404, { error: error.message });
      if (error instanceof EntityConflictError) return sendJson(context.response, 409, { error: error.message });
      if (error instanceof ValidationError || error instanceof BadRequestError) return sendJson(context.response, 400, { error: error.message });
      return sendJson(context.response, 500, { error: "Internal server error" });
    }
  };
}

/** Captures the `/vN/:entity/:id?` route as a generic domain request. */
export function restPatternMiddleware(runtime: EntityRuntime): Middleware {
  return async (context, next) => {
    const route = matchRoute(context.request.url ?? "/");
    if (!route) return sendJson(context.response, 404, { error: "Route not found" });
    if (!runtime.has(route.entityName)) return sendJson(context.response, 404, { error: "Entity not found" });
    const action = actionFor(context.request.method ?? "GET", route.id);
    if (!action) return sendJson(context.response, 405, { error: "Method not allowed" });
    context.domainRequest = { ...route, action };
    await next();
  };
}

/** Captures a single object or a list payload without leaking the raw HTTP body. */
export function payloadPatternMiddleware(runtime: EntityRuntime): Middleware {
  return async (context, next) => {
    const domainRequest = context.domainRequest;
    if (!domainRequest || !requiresBody(domainRequest.action)) return next();
    if (domainRequest.action === "update" || domainRequest.action === "replace") {
      runtime.assertRecord(domainRequest.entityName, domainRequest.id);
    }
    const payload = capturePayload(await readJson(context.request));
    if (domainRequest.action !== "create" && payload.kind === "many") {
      throw new ValidationError("Only POST collection routes accept a list payload");
    }
    domainRequest.payload = payload;
    if (domainRequest.action === "create" && payload.kind === "many") domainRequest.action = "bulkCreate";
    await next();
  };
}

/** Applies schema filtering, repository CRUD and entity lifecycle business rules. */
export function entityLifecycleMiddleware(runtime: EntityRuntime): Middleware {
  return async (context) => {
    const domainRequest = context.domainRequest;
    if (!domainRequest) return;
    const result = await runtime.execute(domainRequest);
    if (domainRequest.action === "delete") return sendEmpty(context.response, 204);
    if (domainRequest.action === "bulkCreate") return sendJson(context.response, 201, { items: result });
    return sendJson(context.response, domainRequest.action === "create" ? 201 : 200, result);
  };
}

function matchRoute(url: string): Pick<DomainRequest, "apiVersion" | "entityName" | "id"> | undefined {
  const pathname = new URL(url, "http://localhost").pathname;
  const match = pathname.match(/^\/(v\d+)\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match) return undefined;
  return { apiVersion: match[1], entityName: decodeURIComponent(match[2]), id: match[3] ? decodeURIComponent(match[3]) : undefined };
}

function actionFor(method: string, id?: string): CrudAction | undefined {
  if (!id && method === "GET") return "list";
  if (!id && method === "POST") return "create";
  if (id && method === "GET") return "get";
  if (id && method === "PUT") return "replace";
  if (id && method === "PATCH") return "update";
  if (id && method === "DELETE") return "delete";
}

function requiresBody(action: CrudAction): boolean {
  return action === "create" || action === "replace" || action === "update";
}

function capturePayload(body: unknown): PayloadPattern {
  return Array.isArray(body) ? { kind: "many", values: body } : { kind: "one", value: body };
}
