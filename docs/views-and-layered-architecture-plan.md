# Views, query languages, and installable layers

## Status and scope

This is the approved-design candidate for the next Exensial refactor. It is intentionally a plan, not an implementation contract yet. The current application continues to expose CRUD, JWT authorization, the runtime entity catalog, and its existing OData-like lookup endpoint while this work is introduced incrementally.

The goal is a small composable platform. An application selects layers; each selected layer contributes a backend installer, an OpenAPI capability descriptor, and (when applicable) a frontend plugin. A frontend must discover capabilities from OpenAPI before calling their endpoints.

## Important terminology

There are two different query languages:

| Name | Purpose | Initial status |
| --- | --- | --- |
| `odata` | URL-oriented, entity-scoped filtering for simple repository lookups. | Supported by adapting the current OData-like filter implementation. |
| `exensialquery` | Read-only SQL-subset AST for projections, joins, groups, aggregates, ordering, pagination, and reusable query views. | Supported through the `exensialquery` package. |
| `graphql` | Graph-shaped query language. | Declared as a possible adapter type only; no endpoint or parser is installed initially. |

The historical `/v1/query/exensial/...` route is not SQL ExensialQuery. It is an OData-like filter route. The migration keeps it as an alias while documenting and advertising it as `odata`; a new ExensialQuery endpoint accepts an AST or a named view rather than SQL in a URL.

## Layer model

The platform has one small composition root and three independently installable product layers.

```text
HTTP adapter / normalized request-response / runtime core
                  |
                  +-- Entities CRUD layer
                  |     entity catalog, definitions, REST CRUD, default views
                  |
                  +-- Authentication and Authorization layer
                  |     identities, JWT/provider adapters, endpoint policy
                  |
                  +-- Views and Menu layer
                  |     view catalog, menu overrides/extensions, menu manifest
                  |
                  +-- UseCases layer
                        declarative REST operations over one or more entities
```

The runtime core owns only normalized request/response, module installation, a capability registry, and persistence interfaces. It does not know the business meaning of entities, users, or views.

### Reusable packages

The intended package boundaries are deliberately narrow:

| Package | Backend contribution | Frontend contribution |
| --- | --- | --- |
| `exensialquery` | AST, parser, formatter, executor, and target-adapter interfaces. | AST builder and in-browser executor where appropriate. |
| `exensial-core` | Runtime contracts, capability registry, HTTP-neutral primitives. | Shared capability descriptor types only. |
| `exensial-entities` | Entity catalog, schema parsing, repositories, CRUD and default-view metadata. | Entity CRUD plugin. |
| `exensial-security` | Authentication and authorization middleware, user/role/permission definitions. | Authentication and authorization console plugin. |
| `exensial-views` | View and menu catalogs, manifest, named view data endpoints, query execution service. | Views/menu/grid plugin. |
| `exensial-usecases` | Use-case catalog, input resolution, runtime operation endpoint and authorization hooks. | Contextual action plugin. |
| `exensial-console` | No backend behavior. | Small vanilla-JS shell and plugin registry. |

The root `exensial` package remains a convenience composition for the existing application and labs. Packages are introduced one layer at a time; no independent package is published until it has its own tests, README, and built public API.

Every backend installer has the same conceptual form:

```ts
interface ExensialLayer {
  id: string;
  install(runtime: Runtime, options?: unknown): void;
  capability(runtime: Runtime): OpenApiCapability | undefined;
}
```

Every optional browser plugin follows the same discovery-driven shape:

```ts
interface ConsoleLayer {
  id: string;
  supports(openApi: OpenApiDocument): boolean;
  install(console: ConsoleHost, openApi: OpenApiDocument): void;
}
```

Neither interface is a runtime dependency for business definitions. Layers communicate through stable runtime and OpenAPI contracts rather than importing one another's UI code.

## Capability discovery in OpenAPI

OpenAPI remains standards-compliant. Exensial uses an extension, never non-standard fields inside standard OpenAPI objects:

```json
{
  "x-exensial-capabilities": {
    "query": {
      "languages": {
        "odata": {
          "version": "1.0",
          "root": "/v1/query/odata",
          "legacyRoots": ["/v1/query/exensial"],
          "transport": "GET"
        },
        "exensialquery": {
          "version": "1.0",
          "root": "/v1/query/exensialquery",
          "transport": "POST",
          "request": "application/json",
          "representation": "exensialquery-ast"
        }
      }
    },
    "views": {
      "catalogPath": "/v1/views",
      "menuCatalogPath": "/v1/menus",
      "manifestPath": "/v1/views/manifest",
      "dataPathTemplate": "/v1/views/{id}/data"
    }
  }
}
```

The capability descriptor tells a client which requests exist. The client fetches the view manifest once when the Views layer is installed, rather than probing each endpoint. Authorization metadata remains on each concrete operation and continues to determine whether the console renders it.

## Query execution and persistence adapters

`exensialquery` owns the canonical `SelectQuery` AST. It must not become a database abstraction or accept untrusted arbitrary JavaScript.

The Views layer receives an AST and dispatches it to a query target adapter:

```ts
interface QueryTargetAdapter {
  id: string;
  supports(query: SelectQuery): boolean;
  execute(query: SelectQuery, context: QueryExecutionContext): Promise<QueryResult>;
}
```

- The initial `in-memory` adapter builds a read-only table map from Exensial repositories and uses `exensialquery.execute`.
- A relational adapter later validates entity/table mappings, compiles the AST through an injected SQL dialect compiler, binds parameters, and executes it through the database connection.
- A non-SQL target such as Mongo is another adapter that declares its supported AST subset. It does not pretend every relational operation is representable.

The default compiler in `exensialquery` is portable SQL serialization. Database-specific compilers are injected by an adapter and remain optional. Cross-entity joins are therefore coordinated by a query execution service, not forced into today's single-entity `Repository<T>` interface. Repositories may later opt into native single-source query execution, but that optimization is not required for the MVP.

Before execution, the Views layer validates that each referenced table maps to an entity, each referenced field is exposed/queryable, the caller is authorized for every source, parameters are supplied, and the AST is within configured complexity limits. This is required even for the in-memory adapter.

## Views and Menu layer

`views` and `menus` are system entities, installed through the Entities layer in the same way as `users`, `roles`, or `localizations`. Their records are declarative and persisted. The Views and Menu layer observes their CRUD lifecycle to compile, validate, cache, and expose the active view and menu records.

`View` has an opaque infrastructure `id`, as every Exensial entity does, and a stable user-defined `viewId`. Other configuration refers to `viewId`, never the persistence identifier. The initial definition is intentionally compact:

```ts
type View = {
  viewId: string;
  kind: "query" | "detail";
  name: string;
  version?: string;
  source?: {
    language: "exensialquery" | "odata" | "graphql";
    ast: json;
  };
  target?: { namespace?: string; entity: string; slot: "query" | "detail" };
  columns?: json;
  fields?: json;
};
```

Menu placement is not embedded in a View. It is independently modeled, versioned, localized, and permission-protected:

```ts
type Menu = {
  menuId: string;
  parentId?: string;
  position?: number;
  visible: boolean;
  icon?: string;
  viewId: string;
};
```

`parentId` references another `menuId`; root entries omit it. `position` is ascending, then `menuId` is the deterministic tie-breaker. `visible` controls presentation only: authorization remains mandatory at the view-data endpoint. A menu can point to an explicit persisted view or to a synthesized default CRUD view.

The menu is never a separate `Views` navigation section. The client first generates default menu entries from entity CRUD query views, using their stable `viewId` values. It then merges persisted `menus` records by `viewId`: a record can override an autogenerated entry's icon, position, parent, or visibility, or add a new entry for a persisted QueryView. A record with `visible: false` hides the autogenerated entry. Entries without a persisted record preserve the entity's contextual group and icon.

### QueryView

A `QueryView` is both a data contract and an executable read model. Its source AST defines the fields, joins, filters, grouping, and aggregate shape returned by the central view-data endpoint. The backend validates and executes that AST through the configured query target adapter: in-memory repositories use the ExensialQuery array executor; a database adapter later compiles the exact same AST and binds it to its own SQL or non-SQL engine.

For the MVP its source language is `exensialquery`; `odata` is retained for simple entity lookup views, and `graphql` validation is rejected until an adapter is installed.

`columns` describes title, visibility, width, and aggregate intent. The server is still authoritative: sorting, filters, grouping, and aggregates are converted to an allowed AST extension and executed by the configured query adapter.

### DetailView

A `DetailView` initially lists declared fields in order. It is metadata only: no form-layout language, custom components, or workflow engine are introduced in the first version. This leaves a stable extension point without premature UI complexity.

### Default CRUD views and overrides

The Entities layer synthesizes implicit views for each entity:

```text
entity:<namespace>.<entity>:query
entity:<namespace>.<entity>:detail
```

An explicit view overrides a default only when its `target` exactly matches the entity and slot. The user-defined `viewId` is human-selected; the recommended convention is `Library_Book_QueryView`, but matching never depends on a fragile string name. This avoids collisions between namespaces while satisfying the recognizable naming convention.

The Views layer supplies default menu records in its manifest for synthesized CRUD query views. Explicit `menus` records override their parent, position, icon, and visibility. A hidden view remains callable only if separately authorized; it is never an authorization mechanism.

## UseCases layer

UseCases are persisted runtime definitions for business operations that do not fit CRUD. They layer on top of entities and never receive raw repository objects or HTTP objects.

```ts
type UseCase = {
  useCaseId: string;
  name: string;
  route: { namespace?: string; entity: string; action: string; method: "POST" };
  inputs: Array<{ name: string; entity: string; namespace?: string; minItems?: number; maxItems?: number }>;
  code: string;
};
```

The request body always has one list of opaque record IDs per declared input:

```json
{ "inputs": { "loans": ["loan-id-1", "loan-id-2"] } }
```

The endpoint is derived from the route, for example `POST /v1/library/loans/return`. The middleware resolves every ID to its declared entity before invoking the trusted runtime module. A business module receives typed domain records and a narrow domain context for entity CRUD; it cannot access HTTP or repository internals. Its OpenAPI operation declares the list inputs, authorization metadata, and an `x-exensial-usecase` extension.

The frontend discovers UseCases from OpenAPI. A use case whose input includes `library/loans` appears as a contextual action anywhere loans are presented: a selected-row batch action in a grid and an individual action on a loan detail. The same endpoint handles one or many IDs.

## Endpoints

The initial endpoints are:

| Endpoint | Purpose |
| --- | --- |
| `/v1/views` and `/v1/views/{id}` | Standard CRUD for persisted view definitions. |
| `/v1/menus` and `/v1/menus/{id}` | Standard CRUD for persisted menu definitions. |
| `/v1/views/manifest` | One authorized, localized description of default and explicit views/menu entries. |
| `/v1/views/{id}/data` | Executes a named QueryView. `POST` supplies safe parameter values and grid state. |
| `/v1/views/{id}/record/{recordId}` | Retrieves the data required for a DetailView; initial version delegates to entity read. |
| `/v1/query/odata/...` | OData-like ad-hoc read capability. |
| `/v1/query/exensialquery` | Ad-hoc ExensialQuery AST execution, when explicitly enabled and authorized. |

Named views are the first implemented execution path. They are installed over REST (`POST /v1/views`) and then invoked through the central view-data endpoint, so they already satisfy the runtime-layer model. The ad-hoc query endpoint remains a future, explicitly opt-in technical capability rather than part of this MVP.

## Grid

There will be one reusable vanilla-JS grid component, owned by the Views console plugin and reused by default entity query views and explicit `QueryView`s.

### MVP behavior

- show/hide and reorder columns; persist only a user's presentation preference in `localStorage`;
- single or multiple sort keys;
- multiple column filters combined with `AND`;
- server-side paging;
- grouping by one or more fields;
- count, sum, average, minimum, and maximum for numeric fields;
- row selection and navigation to an available DetailView;
- defaults inferred from entity metadata, then overridden by a View definition.

The grid emits a neutral `GridQueryState`. The Views plugin converts it into ExensialQuery AST only when that language is advertised; an OData adapter handles only the smaller OData subset. Controls unsupported by the current query language are disabled with a localized explanation. The browser never downloads an unbounded collection to simulate server grouping.

## Library lab outcome

The library installer will create its current entities plus:

1. a `Library_Book_QueryView` with a compact book catalog projection and menu metadata;
2. a `Library_ActiveLoan_QueryView` joining loans, books, and members through ExensialQuery;
3. a primitive `Library_Book_DetailView`;
4. `menus` records that place the catalog and loan views in the Library group;
5. localizations for every view, menu entry, grid label, and operation in English and Spanish.

The lab documentation will show the exact `POST /v1/entities` and `POST /v1/views` payloads. No views or library behavior will be hardcoded in the application source.

## Delivery phases

1. **Foundation and contracts** — introduce the capability registry, layer installer contract, query-language registry, and package/build layout without changing external behavior.
2. **Query service** — adapt existing OData under `odata`, add authenticated/authorized ExensialQuery AST execution, and implement the in-memory query target adapter. Preserve the old OData-like route as a documented alias.
3. **Views backend** — install the `views` and `menus` system entities, lifecycle validation, manifest, query/detail endpoints, OpenAPI extensions, localization, and authorization metadata.
4. **Console refactor** — split the current single generated console script into a small shell and layer plugins; introduce the reusable grid and use it first for default CRUD lists.
5. **Views console and library lab** — render manifest-driven menus, view overrides, query/detail views, then parameterize the library lab and add its reproducible installer/documentation.
6. **Package extraction and hardening** — finalize independent package READMEs, public API tests, migration notes, and remove deprecated compatibility code only in a later major version.

Every phase is independently testable and shippable. It must preserve existing CRUD URLs, authentication behavior, localized OpenAPI, and the current library lab before moving to the next phase.

## Risks and deliberate non-goals

- A general JavaScript-function-to-query compiler is out of scope. It is unsafe and cannot correctly translate arbitrary side effects or control flow.
- GraphQL is not implemented merely because it appears in metadata. It is advertised only after a real adapter is installed.
- Database SQL generation is not assumed to be safe from generic AST serialization. A database adapter owns parameter binding, identifier validation, capability checks, and dialect differences.
- Cross-entity query authorization is mandatory; menu visibility alone never grants data access.
- The existing console is a single large HTML/JavaScript source. Its plugin split is a controlled refactor, not a cosmetic append of more wrappers.
- View definitions can be versioned alongside entities. The MVP resolves the highest compatible entity/view version by API major, matching existing entity-version semantics.

## Decisions needed before implementation

1. Preserve `/v1/query/exensial/...` indefinitely as a compatibility alias for the current OData-like behavior, or deprecate it immediately while keeping it only through the next major version?
2. Should a user-created `QueryView` be able to reference and join any entity it is authorized to read, or initially only entities within its namespace? The plan recommends any authorized entity, because the library active-loan view needs cross-entity joins.
3. The first release executes named persisted views only. An ad-hoc `POST /v1/query/exensialquery` endpoint remains a later opt-in capability for administrative or technical clients.
