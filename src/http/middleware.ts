import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { EntityConflictError, EntityNotFoundError, type EntityRuntime, ValidationError } from "../application/entity-runtime";
import { compileExensialFilter } from "../application/exensial-query";
import { executeQueryView, queryViewSourcePaths, viewManifest } from "../application/views";
import type { GridQuery } from "../application/grid-query";
import { executeGridQuery } from "../application/grid-query";
import { executeUseCase, installedUseCases, routeForUseCase } from "../application/use-cases";
import type { LocalizationEntry } from "../application/localization";
import type { EntityRecord } from "../domain/entity";
import type { CrudAction, DomainRequest, PayloadPattern } from "../domain/request";
import type { DomainResponse } from "../domain/response";
import { BadRequestError, parseJson, readBody, sendEmpty, sendJson } from "../http";
import { createOpenApi } from "../openapi";
import { consoleHtml } from "../ui/console";
import { authenticate, authorize, hashPassword, issueToken, readToken, verifyPassword, type SecurityPrincipal, UnauthorizedError, ForbiddenError } from "../application/security";

type HttpInput = { method: string; url: string; body?: string };
const require = createRequire(import.meta.url);
const consoleAssets: Record<string, { path: string; contentType: string }> = {
  "/assets/codemirror.css": { path: require.resolve("codemirror/lib/codemirror.css"), contentType: "text/css; charset=utf-8" },
  "/assets/codemirror.js": { path: require.resolve("codemirror/lib/codemirror.js"), contentType: "application/javascript; charset=utf-8" },
  "/assets/codemirror-typescript.js": { path: require.resolve("codemirror/mode/javascript/javascript.js"), contentType: "application/javascript; charset=utf-8" }
};
const consoleModelPath = fileURLToPath(new URL("../ui/console-model.ts", import.meta.url));
export type RequestContext = {
  request: IncomingMessage;
  response: ServerResponse;
  requestStartedAt?: number;
  httpInput?: HttpInput;
  domainRequest?: DomainRequest;
  domainResponse?: DomainResponse;
  requestRecord?: EntityRecord;
  principal?: SecurityPrincipal;
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
export function documentationMiddleware(runtime: EntityRuntime, options: { exensialQuery?: boolean; security?: boolean; views?: boolean } = {}): Middleware {
  return async (context, next) => {
    const url = new URL(requireHttpInput(context).url, "http://localhost");
    const pathname = url.pathname;
    const language = url.searchParams.get("lang") || "en";
    const apiVersion = `v${Number(url.searchParams.get("version") ?? runtime.latestMajor())}`;
    const localizations = runtime.listRecords("localizations").map(({ locale, key, value }) => ({ locale, key, value })) as LocalizationEntry[];
    if (pathname === "/openapi.json") {
      context.domainResponse = { status: 200, body: createOpenApi(runtime.definitions(apiVersion), { ...options, language, localizations, useCases: runtime.has("useCases") ? installedUseCases(runtime) : [], permissions: options.security && runtime.has("permissions") ? runtime.listRecords("permissions") : [], roles: options.security && runtime.has("roles") ? runtime.listRecords("roles") : [] }) };
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
    if (pathname === "/assets/console-model.js") {
      const source = await readFile(consoleModelPath, "utf8");
      const body = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText;
      context.domainResponse = { status: 200, headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=3600" }, body };
      return;
    }
    const asset = consoleAssets[pathname];
    if (asset) {
      context.domainResponse = { status: 200, headers: { "content-type": asset.contentType, "cache-control": "public, max-age=3600" }, body: await readFile(asset.path, "utf8") };
      return;
    }
    await next();
  };
}

/** Handles local JWT login. Other identity providers can populate context.principal before authorization. */
export function authenticationMiddleware(runtime: EntityRuntime, enabled = true): Middleware {
  return async (context, next) => {
    if (!enabled) return next();
    const input = requireHttpInput(context);
    const url = new URL(input.url, "http://localhost");
    if (url.pathname === "/v1/auth/login") {
      if (input.method !== "POST") throw new MethodNotAllowedError();
      const payload = parseJson(input.body ?? "") as Record<string, unknown>;
      const principal = authenticate(runtime, payload.username, payload.password);
      context.domainResponse = { status: 200, body: { accessToken: issueToken(principal, process.env.EXENSIAL_JWT_SECRET ?? "exensial-development-secret"), tokenType: "Bearer", expiresIn: 28_800, user: principal } };
      return;
    }
    context.principal = readToken(context.request.headers.authorization, process.env.EXENSIAL_JWT_SECRET ?? "exensial-development-secret");
    if (url.pathname === "/v1/auth/change-password") {
      if (input.method !== "POST") throw new MethodNotAllowedError();
      if (!context.principal) throw new UnauthorizedError("Authentication is required");
      const payload = parseJson(input.body ?? "") as Record<string, unknown>;
      const user = runtime.findRecord("users", context.principal.id);
      if (!user || !verifyPassword(String(payload.currentPassword ?? ""), user.passwordHash)) throw new UnauthorizedError("Current password is incorrect");
      const nextPassword = String(payload.newPassword ?? "");
      if (nextPassword.length < 8) throw new ValidationError("New password must contain at least 8 characters");
      await runtime.execute({ apiVersion: "v1", entityName: "users", action: "update", id: user.id, payload: { kind: "one", value: { passwordHash: hashPassword(nextPassword) } } });
      context.domainResponse = { status: 204 };
      return;
    }
    if (url.pathname === "/v1/auth/profile") {
      if (!context.principal) throw new UnauthorizedError("Authentication is required");
      const user = runtime.findRecord("users", context.principal.id);
      if (!user) throw new UnauthorizedError("Authenticated user no longer exists");
      if (input.method === "GET") {
        context.domainResponse = { status: 200, body: profile(user) };
        return;
      }
      if (input.method !== "PATCH") throw new MethodNotAllowedError();
      const payload = parseJson(input.body ?? "") as Record<string, unknown>;
      if (Object.keys(payload).some((key) => !["username", "email"].includes(key))) throw new ValidationError("Only username and email can be updated in the profile");
      if ("username" in payload && !String(payload.username ?? "").trim()) throw new ValidationError("Username cannot be empty");
      await runtime.execute({ apiVersion: "v1", entityName: "users", action: "update", id: user.id, payload: { kind: "one", value: payload } });
      const current = runtime.findRecord("users", user.id)!;
      const principal = { ...context.principal, username: String(current.username) };
      context.domainResponse = { status: 200, body: { user: profile(current), accessToken: issueToken(principal, process.env.EXENSIAL_JWT_SECRET ?? "exensial-development-secret") } };
      return;
    }
    await next();
  };
}

function profile(user: Record<string, unknown>): Record<string, unknown> {
  return { id: user.id, username: user.username, email: user.email };
}

/** Enforces endpoint policy after REST route capture and before any entity mutation. */
export function authorizationMiddleware(runtime: EntityRuntime, enabled = true): Middleware {
  return async (context, next) => {
    if (!enabled) return next();
    const input = requireHttpInput(context);
    authorize(runtime, context.principal, input.method, new URL(input.url, "http://localhost").pathname);
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
    const definition = runtime.definitions(route.apiVersion).find((item) => item.name === route.entityName && item.context?.namespace === route.namespace);
    if (!definition) throw new EntityNotFoundError("Entity not found");
    const skip = queryInteger(url.searchParams.get("$skip"), "$skip", 0, 0, 100_000);
    const take = queryInteger(url.searchParams.get("$top"), "$top", 25, 1, 100);
    const result = runtime.query(route.entityName, compileExensialFilter(url.searchParams.get("$filter"), definition), { skip, take }, route.namespace, route.apiVersion);
    context.domainResponse = {
      status: 200,
      headers: { "X-Total-Count": String(result.total), "X-Query-Skip": String(skip), "X-Query-Top": String(take) },
      body: result.items
    };
  };
}

/** Exposes a single localized/discoverable manifest for installed Views and Menus. */
export function viewsMiddleware(runtime: EntityRuntime, enabled = true): Middleware {
  return async (context, next) => {
    if (!enabled) return next();
    const input = requireHttpInput(context);
    const url = new URL(input.url, "http://localhost");
    const apiVersion = `v${Number(url.searchParams.get("version") ?? runtime.latestMajor())}`;
    if (url.pathname === "/v1/views/manifest") {
      if (input.method !== "GET") throw new MethodNotAllowedError();
      context.domainResponse = { status: 200, body: viewManifest(runtime, apiVersion) };
      return;
    }
    const match = url.pathname.match(/^\/v\d+\/views\/([^/]+)\/data$/);
    if (!match) return next();
    if (input.method !== "POST") throw new MethodNotAllowedError();
    const viewId = decodeURIComponent(match[1]);
    if (runtime.has("permissions")) for (const path of queryViewSourcePaths(runtime, viewId, apiVersion)) authorize(runtime, context.principal, "GET", path);
    const payload = input.body?.trim() ? parseJson(input.body) : {};
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ValidationError("QueryView parameters must be a JSON object");
    const parameters = (payload as { parameters?: unknown }).parameters ?? {};
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || Object.values(parameters).some((value) => !["string", "number", "boolean"].includes(typeof value) && value !== null)) throw new ValidationError("QueryView parameters must be scalar values");
    const grid = (payload as { grid?: unknown }).grid;
    if (grid !== undefined && (!grid || typeof grid !== "object" || Array.isArray(grid))) throw new ValidationError("Grid query must be an object");
    const result = executeQueryView(runtime, viewId, parameters as Record<string, string | number | boolean | null>, apiVersion, grid as GridQuery | undefined);
    context.domainResponse = { status: 200, headers: { "X-Total-Count": String(result.total) }, body: { viewId: result.view.viewId, items: result.items } };
  };
}

/** Executes the same GridQuery contract over an entity collection. */
export function gridMiddleware(runtime: EntityRuntime): Middleware {
  return async (context, next) => {
    const input = requireHttpInput(context), url = new URL(input.url, "http://localhost");
    const match = url.pathname.match(/^\/v(\d+)\/grid\/(?:(\w[\w.-]*)\/)?(\w[\w-]*)$/);
    if (!match) return next();
    if (input.method !== "POST") throw new MethodNotAllowedError();
    const [, major, namespace, entityName] = match, apiVersion = `v${major}`;
    const entityPath = `/v${major}/${namespace ? `${namespace}/` : ""}${entityName}`;
    if (runtime.has("permissions")) authorize(runtime, context.principal, "GET", entityPath);
    const payload = input.body?.trim() ? parseJson(input.body) : {};
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ValidationError("Grid query body must be an object");
    const grid = (payload as { grid?: unknown }).grid;
    if (grid !== undefined && (!grid || typeof grid !== "object" || Array.isArray(grid))) throw new ValidationError("Grid query must be an object");
    const request: DomainRequest = { apiVersion, entityName, ...(namespace ? { namespace } : {}), action: "list", pagination: { page: 1, perPage: 100_000 } };
    const rows = runtime.publicResult(request, runtime.listRecords(entityName, namespace)) as EntityRecord[];
    const result = executeGridQuery(rows, grid as GridQuery | undefined);
    context.domainResponse = { status: 200, headers: { "X-Total-Count": String(result.total) }, body: result.items };
  };
}

/** Executes persisted domain operations after resolving their declared record-ID inputs. */
export function useCasesMiddleware(runtime: EntityRuntime, enabled = true): Middleware {
  return async (context, next) => {
    if (!enabled) return next();
    const input = requireHttpInput(context);
    const url = new URL(input.url, "http://localhost");
    const useCase = installedUseCases(runtime).find((candidate) => routeForUseCase(candidate) === url.pathname);
    if (!useCase) return next();
    if (input.method !== "POST") throw new MethodNotAllowedError();
    const value = parseJson(input.body ?? "");
    const result = await executeUseCase(runtime, useCase, value, requestLanguage(context));
    context.domainResponse = { status: 200, body: { useCaseId: useCase.useCaseId, result } };
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
    context.domainRequest = { ...route, action, language: requestLanguage(context), ...(action === "list" ? { pagination: pagination(input.url) } : {}) };
    await next();
  };
}

/** Captures a single object or list payload, without passing an HTTP body into the domain. */
export function payloadPatternMiddleware(runtime: EntityRuntime): Middleware {
  return async (context, next) => {
    const domainRequest = context.domainRequest;
    if (!domainRequest || !requiresBody(domainRequest.action)) return next();
    if (domainRequest.action === "update" || domainRequest.action === "replace") {
      runtime.assertRecord(domainRequest.entityName, domainRequest.id, domainRequest.namespace, domainRequest.apiVersion);
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
          ...(request.id ? { requestItemId: request.id } : {}),
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
    const result = runtime.publicResult(request, await runtime.execute(request));
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

function requestLanguage(context: RequestContext): string {
  const urlLanguage = new URL(requireHttpInput(context).url, "http://localhost").searchParams.get("lang");
  const header = context.request.headers["accept-language"];
  return (urlLanguage ?? (Array.isArray(header) ? header[0] : header) ?? "en").split(",")[0].split("-")[0] || "en";
}

function paginationHeaders(context: RequestContext, runtime: EntityRuntime, request: DomainRequest): Record<string, string> {
  const { page, perPage } = request.pagination!;
  const total = runtime.count(request.entityName, request.namespace, request.apiVersion);
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
  if (error instanceof UnauthorizedError) return { status: 401, headers: { "www-authenticate": "Bearer" }, body: { error: error.message } };
  if (error instanceof ForbiddenError) return { status: 403, body: { error: error.message } };
  if (error instanceof EntityNotFoundError) return { status: 404, body: { error: error.message } };
  if (error instanceof EntityConflictError) return { status: 409, body: { error: error.message } };
  if (error instanceof MethodNotAllowedError) return { status: 405, body: { error: error.message } };
  if (error instanceof ValidationError || error instanceof BadRequestError) return { status: 400, body: { error: error.message } };
  return { status: 500, body: { error: "Internal server error" } };
}

function writeHttpResponse(response: ServerResponse, domain: DomainResponse): void {
  for (const [name, value] of Object.entries(domain.headers ?? {})) response.setHeader(name, value);
  if (domain.body === undefined) return sendEmpty(response, domain.status);
  if (typeof domain.body === "string") {
    response.statusCode = domain.status;
    if (!response.hasHeader("content-type")) response.setHeader("content-type", "text/plain; charset=utf-8");
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
  if (parts.length === 1 && runtime.has(parts[0], undefined, apiVersion)) return { apiVersion, entityName: parts[0] };
  if (parts.length === 2) {
    if (runtime.has(parts[0], undefined, apiVersion)) return { apiVersion, entityName: parts[0], id: parts[1] };
    if (runtime.has(parts[1], parts[0], apiVersion)) return { apiVersion, namespace: parts[0], entityName: parts[1] };
  }
  if (parts.length === 3 && runtime.has(parts[1], parts[0], apiVersion)) {
    return { apiVersion, namespace: parts[0], entityName: parts[1], id: parts[2] };
  }
  return undefined;
}

function matchExensialQueryRoute(url: string, runtime: EntityRuntime): Pick<DomainRequest, "apiVersion" | "namespace" | "entityName"> | undefined {
  const segments = new URL(url, "http://localhost").pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [apiVersion, engine, capability, nameOrNamespace, maybeName, extra] = segments;
  if (!apiVersion || !/^v\d+$/.test(apiVersion) || engine !== "query" || !["exensial", "odata"].includes(capability) || extra) return undefined;
  if (maybeName && runtime.has(maybeName, nameOrNamespace, apiVersion)) return { apiVersion, namespace: nameOrNamespace, entityName: maybeName };
  if (!maybeName && runtime.has(nameOrNamespace, undefined, apiVersion)) return { apiVersion, entityName: nameOrNamespace };
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exensial API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"><style>#language-picker{position:fixed;right:22px;top:13px;z-index:10;padding:6px}</style></head><body><select id="language-picker" aria-label="Language"></select><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>const current=new URL(location.href).searchParams.get('lang')||localStorage.getItem('exensial.language')||'en';fetch('/openapi.json?lang='+encodeURIComponent(current)).then(r=>r.json()).then(doc=>{const picker=document.getElementById('language-picker');picker.innerHTML=(doc['x-exensial-locales']||['en']).map(locale=>'<option '+(locale===current?'selected':'')+' value="'+locale+'">'+locale+'</option>').join('');picker.onchange=event=>{localStorage.setItem('exensial.language',event.target.value);const url=new URL(location.href);url.searchParams.set('lang',event.target.value);location.href=url};SwaggerUIBundle({spec:doc,dom_id:'#swagger-ui'})})</script></body></html>`;
}
