# Exensial architecture

## Purpose

Exensial turns runtime-defined collections into REST resources. A client sends a declarative TypeScript type alias to the entity catalog, and the installed entity receives generic CRUD without hand-written routes.

Routes are versioned. An unnamespaced entity uses `/v1/:entity/:id?`; a namespaced entity uses `/v1/:namespace/:entity/:id?`.

```text
POST /v1/entities                    -> define a collection
POST /v1/tasks                       -> create an unnamespaced record
GET  /v1/acme.work/tasks             -> list a namespaced collection
PATCH /v1/acme.work/tasks/:id        -> update a record
DELETE /v1/acme.work/tasks/:id       -> delete a record
```

## Request pipeline

```text
HTTP request
  -> HTTP adapter
  -> documentation middleware
  -> REST pattern middleware
  -> response repository middleware
  -> payload pattern middleware
  -> request repository middleware
  -> entity lifecycle middleware
  -> DomainResponse
  -> HTTP response
```

The HTTP adapter is the only layer that knows Node's `IncomingMessage` and `ServerResponse`. It produces a small HTTP input and, at the end, writes a `DomainResponse`. Internal layers work with `DomainRequest` and `DomainResponse`, so CRUD, repositories, and business behavior are not tied to HTTP.

The REST pattern middleware resolves a route against installed entities, captures version, optional namespace, entity name, optional id, and turns the HTTP method into `list`, `get`, `create`, `bulkCreate`, `replace`, `update`, or `delete`. An unknown route or entity returns `404` before CRUD runs.

The payload middleware converts a JSON object into `one` and a JSON list into `many`. A list is allowed only for collection `POST` and becomes `bulkCreate`. It resolves an item before parsing an update body so a missing id returns `404` consistently.

Requests and responses are stored through ordinary system entities, `requests` and `responses`. Each request has an ISO 8601 `receivedAt` timestamp. Each response has `completedAt` and `durationMs`, measured from receipt by the HTTP adapter until the domain response is ready, before persisting the audit response itself. These fields support latency and throughput analysis through the same repository abstraction without sending audit writes back through HTTP.

## Runtime, entities, and repositories

`EntityRuntime` owns the installed entities. Each installed entity contains an `EntityDefinition` with fields, localized documentation, and optional context; a `Repository<EntityRecord>`; and optional lifecycle hooks and operation middleware.

The identity is `(namespace, name)`. The runtime uses that pair internally, which permits `acme.sales/orders` and `acme.support/orders` to coexist. The current repository is `InMemoryRepository`; changing persistence should retain the `Repository` contract and not affect routing or business behavior.

The system `entities` module is itself an ordinary CRUD entity with extra lifecycle rules. Creating a definition validates its type alias and installs a new module. Updating a definition replaces its schema while retaining its repository. Deleting it removes the installed entity and its endpoint. The catalog is installed only when `EXENSIAL_ENABLE_ENTITY_CATALOG` is not `false`, or when `createApp({ enableEntityCatalog: true })` is used.

## Business operation middleware

A trusted module can attach middleware to any CRUD action. The runtime validates and prepares the context first, then composes operation middleware around generic repository CRUD. `await next()` extends the default action; omitting it replaces the action. `next()` may be called once per layer.

Modules are imported and registered by application code. An HTTP request can select only a registered module id; it cannot submit or execute code. See [the entity authoring guide](entities.md) for a complete example and the middleware context contract.

## Type aliases and documentation

The parser deliberately accepts a narrow, declarative subset: fields of type `string`, `number`, `boolean`, or `json`, plus optional `?`. It does not evaluate or import submitted TypeScript.

`@exensial.title <locale> <text>` and `@exensial.description <locale> <text>` are parsed from JSDoc preceding the alias or a field. They are retained in `documentation`, emitted as `x-exensial-localized`, and used to generate standard English OpenAPI text when English is available.

`GET /openapi.json` generates OpenAPI 3.0.4 from the current runtime. It includes active routes, schemas, localized metadata, and `x-exensial-context` containing namespace, module id, and intercepted operations. `GET /docs` serves Swagger UI over that generated document.

## Technical decisions and current limits

- Node HTTP keeps the transport boundary explicit and the dependency set minimal.
- TypeScript executes through `tsx`, while `tsc --noEmit` remains the static type check.
- Repositories, operation middleware, and HTTP adapters are independent seams for future persistence and transports.
- Runtime definitions and their data are in memory; restarting the process clears both.
- Authentication, authorization, pagination, migrations, relations, typed arrays, dates, and richer constraints are intentionally outside this minimal implementation.
