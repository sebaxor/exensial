import type { IncomingMessage, ServerResponse } from "node:http";
import { EntityConflictError, EntityNotFoundError, type CrudAction, type EntityRuntime, ValidationError } from "../application/entity-runtime";
import { BadRequestError, readJson, sendEmpty, sendJson } from "../http";

type Operation = { entityName: string; action: CrudAction; id?: string };
export type RequestContext = { request: IncomingMessage; response: ServerResponse; operation?: Operation };
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

/** Resolves a REST operation and fails before dispatching if the entity does not exist. */
export function restOperationMiddleware(runtime: EntityRuntime): Middleware {
  return async (context, next) => {
    const parts = new URL(context.request.url ?? "/", "http://localhost").pathname.split("/").filter(Boolean);
    if (parts.length < 1 || parts.length > 2) return sendJson(context.response, 404, { error: "Route not found" });
    const [entityName, id] = parts;
    if (!runtime.has(entityName)) return sendJson(context.response, 404, { error: "Entity not found" });
    const action = actionFor(context.request.method ?? "GET", id);
    if (!action) return sendJson(context.response, 405, { error: "Method not allowed" });
    context.operation = { entityName, action, id };
    await next();
  };
}

/** Executes repository CRUD plus business lifecycle hooks from the entity module. */
export function entityLifecycleMiddleware(runtime: EntityRuntime): Middleware {
  return async (context) => {
    const operation = context.operation;
    if (!operation) return;
    try {
      // Resolve the target before reading a body so a missing resource remains a 404.
      if (operation.action === "update") runtime.assertRecord(operation.entityName, operation.id);
      const input = operation.action === "create" || operation.action === "update" ? await readJson(context.request) : undefined;
      const result = await runtime.execute(operation.entityName, operation.action, operation.id, input);
      if (operation.action === "delete") return sendEmpty(context.response, 204);
      return sendJson(context.response, operation.action === "create" ? 201 : 200, result);
    } catch (error) {
      if (error instanceof EntityNotFoundError) return sendJson(context.response, 404, { error: error.message });
      if (error instanceof EntityConflictError) return sendJson(context.response, 409, { error: error.message });
      if (error instanceof ValidationError || error instanceof BadRequestError) return sendJson(context.response, 400, { error: error.message });
      return sendJson(context.response, 500, { error: "Internal server error" });
    }
  };
}

function actionFor(method: string, id?: string): CrudAction | undefined {
  if (!id && method === "POST") return "create";
  if (!id && method === "GET") return "list";
  if (id && method === "GET") return "get";
  if (id && method === "PATCH") return "update";
  if (id && method === "DELETE") return "delete";
}
