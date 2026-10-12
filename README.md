# Exensial

Exensial is a minimal TypeScript runtime for defining data collections and exposing standard REST CRUD at runtime.

Its conceptual inspiration is the idea of a *set*: an entity defines the shape and rules of a collection, and its records are the elements in that collection. Earlier exploration referred to this idea as “ZFC”; Exensial deliberately uses domain-oriented names such as **entity** and **record** instead.

The source runs directly through `tsx`; internal imports intentionally omit file extensions.

```bash
npm install
npm test
npm start
```

Create an entity by sending a constrained TypeScript type alias. Supported field types are `string`, `number`, `boolean`, and `json`.

```bash
curl -X POST http://localhost:3000/v1/entities \
  -H 'content-type: application/json' \
  -d '{"name":"tasks","definition":"type Task = { title: string; completed?: boolean }"}'
```

An entity with no namespace is available at `/v1/tasks`:

```bash
curl -X POST http://localhost:3000/v1/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"Draft the report"}'
curl http://localhost:3000/v1/tasks
curl http://localhost:3000/v1/tasks/:id
curl -X PATCH http://localhost:3000/v1/tasks/:id \
  -H 'content-type: application/json' \
  -d '{"completed":true}'
curl -X DELETE http://localhost:3000/v1/tasks/:id
```

`namespace` is optional. When supplied, it is part of the route after the API version:

```bash
curl -X POST http://localhost:3000/v1/entities \
  -H 'content-type: application/json' \
  -d '{"name":"tasks","namespace":"acme.work","definition":"type Task = { title: string }"}'

curl -X POST http://localhost:3000/v1/acme.work/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"Review the proposal"}'
```

`entities` is a system entity. Its repository stores the definitions, while its lifecycle installs, updates, or removes the matching runtime entity. Data is intentionally in memory, so a restart clears it.

Every recognized request and normalized response are also stored as the system entities `/v1/requests` and `/v1/responses`. A response reuses its request's `id`, so records correlate directly without a second relation field. Requests include `receivedAt`; responses include `completedAt` and `durationMs`, enabling timing and throughput analysis. API documentation is generated from the active entities at `/openapi.json`; Swagger UI is served at `/docs`.

The entity catalog is enabled by default. Run `EXENSIAL_ENABLE_ENTITY_CATALOG=false npm start` to expose only application-installed modules and disable `/v1/entities`.

Read [the entity authoring guide](docs/entities.md) for type syntax, localized JSDoc, namespaces, and business behavior. Read [the architecture](docs/architecture.md) for pipeline and design decisions.

Runtime domain examples are documented as independent [labs](docs/labs/README.md). Each lab contains compact domain definitions first and reproducible curls in its appendix.
