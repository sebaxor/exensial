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

## Layering and reuse

The system is intentionally layered. A layer may use the layer below it, but no lower layer knows a domain such as a library, books, or loans.

```text
HTTP adapter
  -> generic REST pattern and CRUD runtime
    -> ordinary repositories
      -> system entities: requests, responses, entities, localizations, users, roles, permissions
        -> runtime-defined entities and their domain code
```

- The generic CRUD runtime owns validation, repositories, and the standard REST operations. It has no domain-specific names.
- `requests`, `responses`, `localizations`, `users`, `roles`, and `permissions` are ordinary system entities using that same runtime. `passwordHash` is a sensitive field and is redacted at the HTTP representation boundary.
- `entities` is another ordinary system entity. Its records are entity definitions; its lifecycle installs, replaces, or removes an entity in the runtime. It does not contain book, loan, or application-specific rules.
- A dynamic entity can include TypeScript `code`, stored in its `entities` record and installed on top of generic CRUD. The library example is therefore runtime data, not production source code.

The only fixed behavior above generic CRUD is the runtime-code compiler and its domain facade. It does not name or assume any business entity; it receives names such as `books` only from a runtime entity definition.

## Request pipeline

```text
HTTP request
  -> HTTP adapter
  -> documentation middleware
  -> authentication endpoint / Bearer-token capture
  -> authorization middleware
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

Requests and responses are stored through ordinary system entities, `requests` and `responses`. A request and its response share the same `id`: the response repository deliberately creates its record with the id generated for the request, so no `requestId` relation field is needed. Each request has an ISO 8601 `receivedAt` timestamp. Each response has `completedAt` and `durationMs`, measured from receipt by the HTTP adapter until the domain response is ready, before persisting the audit response itself. These fields support latency and throughput analysis through the same repository abstraction without sending audit writes back through HTTP.

## Runtime, entities, and repositories

`EntityRuntime` owns the installed entities. Each installed entity contains an `EntityDefinition` with fields, localized documentation, and optional context; a `Repository<EntityRecord>`; and optional lifecycle hooks and operation middleware.

The identity is `(namespace, name)`. The runtime uses that pair internally, which permits `acme.sales/orders` and `acme.support/orders` to coexist. The current repository is `InMemoryRepository`; changing persistence should retain the `Repository` contract and not affect routing or business behavior.

The system `entities` module is itself an ordinary CRUD entity with extra lifecycle rules. Creating a definition validates its type alias and installs a new module. Updating a definition replaces its schema while retaining its repository. Deleting it removes the installed entity and its endpoint. The catalog is installed only when `EXENSIAL_ENABLE_ENTITY_CATALOG` is not `false`, or when `createApp({ enableEntityCatalog: true })` is used.

## Runtime business code

An entity can send a `code` string containing a TypeScript module with `export default { create, update, ... }`. It receives only a domain facade: input/current/result, `fail`, and record operations on other entities. The facade contains no HTTP request, response, repository, or database objects. Therefore source can survive a later replacement of the in-memory repository by a table repository.

In this MVP the TypeScript executor is deliberately a controlled-development capability, not a security sandbox. It must not be reachable by untrusted callers. See [runtime TypeScript domain modules](runtime-code.md) for its contract and persistence/transaction limitations.

## Type aliases and documentation

The parser deliberately accepts a narrow, declarative subset: fields of type `string`, `number`, `boolean`, or `json`, plus optional `?`. It does not evaluate or import submitted TypeScript.

`@exensial.title <locale> <text>` and `@exensial.description <locale> <text>` are parsed from JSDoc preceding the alias or a field. They are retained in `documentation`, emitted as `x-exensial-localized`, and used to generate standard English OpenAPI text when English is available.

`GET /openapi.json` generates OpenAPI 3.0.4 from the current runtime. It includes active routes, schemas, localized metadata, and `x-exensial-context` containing namespace and intercepted operations. Every generated CRUD operation has an `operationId`, a purpose-specific description, and schema-derived examples for requests and successful responses. Collection `POST` exposes separate examples for creating one record and importing a list; item operations show id, replacement, partial-update, and error examples. `GET /docs` serves Swagger UI over that generated document.

## Technical decisions and current limits

- Node HTTP keeps the transport boundary explicit and the dependency set minimal.
- Submitted runtime code is transpiled by the TypeScript compiler and evaluated through Node's `vm` API with an explicit, minimal context; `tsx` runs the service and tests, while `tsc --noEmit` remains the static type check.
- Repositories, operation middleware, and HTTP adapters are independent seams for future persistence and transports.
- Runtime definitions and their data are in memory; restarting the process clears both.
- The optional security layer adds local JWT authentication and role-based endpoint permissions before the CRUD pipeline; it can be disabled with `EXENSIAL_ENABLE_SECURITY=false`. Identity providers, migrations, typed arrays, dates, and richer constraints remain extension points. Collection pagination is supported through `page` and `perPage` query parameters plus response headers.
- Query engines are optional technical capabilities, rather than an implicit feature of CRUD. When enabled, each declares its root and contract in `x-exensial-capabilities` in OpenAPI. The current `ExensialQuery` engine is a safe, read-only OData-like subset backed by the repository query boundary; GraphQL and OData can be added later as independent engines.
