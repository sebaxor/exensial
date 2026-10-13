# Authoring entities in Exensial

## Schema-only entity

Send a TypeScript type alias to `POST /v1/entities`. The `name` becomes the REST resource name.

```json
{
  "name": "tasks",
  "definition": "type Task = { title: string; completed?: boolean }"
}
```

This immediately creates `POST/GET /v1/tasks` and `GET/PUT/PATCH/DELETE /v1/tasks/:id`. Supported field types are `string`, `number`, `boolean`, and `json`; `?` marks an optional field.

## Namespaces and routes

`namespace` is optional. It is a package-style identifier such as `acme.work` and becomes the route segment immediately after the API version.

```json
{
  "name": "tasks",
  "namespace": "acme.work",
  "definition": "type Task = { title: string }"
}
```

The resulting routes are `GET/POST /v1/acme.work/tasks` and `GET/PUT/PATCH/DELETE /v1/acme.work/tasks/:id`. Without a namespace, the routes remain `/v1/tasks`. The pair `(namespace, name)` is the entity identity, so separate namespaces may use the same name.

## Worked example: books and loans

First create the collection definition. This request creates the *place where books will be stored*; it does not create a book yet.

```json
POST /v1/entities
{
  "name": "books",
  "namespace": "library",
  "definition": "type Book = { title: string; author: string; isbn: string; copiesTotal: number; copiesAvailable?: number }"
}
```

Then add a book to the generated collection route:

```json
POST /v1/library/books
{
  "title": "The Left Hand of Darkness",
  "author": "Ursula K. Le Guin",
  "isbn": "978-0441478125",
  "copiesTotal": 2
}
```

The response includes the generated `id`. Store that id when creating a related loan:

```json
POST /v1/library/loans
{
  "book": "<book-id>",
  "member": "<member-id>",
  "borrowedAt": "2026-10-12T10:00:00.000Z",
  "dueAt": "2026-10-26T10:00:00.000Z"
}
```

The relation values are generated ids, but the names remain domain-oriented. Add a runtime `code` module when the entity must look up related records, enforce business criteria, or update another entity as part of the operation.

## Localized documentation

Use JSDoc inside the definition. `@exensial.title` and `@exensial.description` take a locale followed by text. Place them before the type alias or a field.

```ts
/**
 * @exensial.title en Tasks
 * @exensial.title es Tareas
 * @exensial.description en Work items for a team
 */
type Task = {
  /**
   * @exensial.title en Title
   * @exensial.title es Título
   * @exensial.description en A concise task summary
   */
  title: string;
  completed?: boolean;
}
```

OpenAPI uses English by default in standard `title` and `description` properties and preserves every source locale in `x-exensial-localized`. `GET /openapi.json?lang=es` selects a matching JSDoc locale when present. The system `localizations` entity can override those generated labels at runtime; see [runtime localization](localization.md).

Entity comments can also name each generated OpenAPI operation. This keeps endpoint summaries in the entity definition rather than in HTTP infrastructure:

```ts
/**
 * @exensial.operation list en List tasks
 * @exensial.operation list es Listar tareas
 * @exensial.operation create en Create or import tasks
 * @exensial.operation create es Crear o importar tareas
 * @exensial.operation get es Consultar una tarea
 * @exensial.operation replace es Reemplazar una tarea
 * @exensial.operation update es Actualizar una tarea
 * @exensial.operation delete es Eliminar una tarea
 * @exensial.operation query es Consultar tareas
 */
type Task = { title: string };
```

The supported operation names are `list`, `create`, `get`, `replace`, `update`, `delete`, and `query`. A runtime override uses `entity.<namespace.name-or-name>.operation.<operation>.summary`.

## Default values

Use `@exensial.default` on a field to provide a JSON default. The value is applied when that field is omitted during a `POST` create or bulk import. It is not re-applied by `PUT` or `PATCH`, so an update remains explicit.

```ts
type Task = {
  title: string;
  /** @exensial.default "draft" */
  status: string;
  /** @exensial.default false */
  completed?: boolean;
  /** @exensial.default 3 */
  priority?: number;
  /** @exensial.default {"labels":[]} */
  metadata?: json;
}
```

The annotation value must be valid JSON: quote strings, use `true` or `false` for booleans, and use JSON object or array syntax for `json` fields. A field with a default is optional in create input, even if it is not marked with `?` in the TypeScript shape.

Exensial publishes this through the standard OpenAPI Schema Object `default` property—no custom extension is needed. Generic clients can use it safely; the bundled Console uses it to prefill the **New record** form.

## UI metadata and relations

Field JSDoc can also declare presentation hints. Exensial exports them under the vendor extension `x-exensial-ui` in OpenAPI; consumers that do not understand the extension can safely ignore it.

```ts
type Loan = {
  /** @exensial.relation library/books label=title */
  book: Book;
  /** @exensial.relation library/members label=name */
  member: Member;
  /** @exensial.ui.control datetime */
  borrowedAt: string;
  /** @exensial.ui.hidden */
  internalState?: string;
  /** @exensial.ui.control money */
  lateFee?: number;
}
```

- `@exensial.ui.hidden` hides a field from generic consoles and tables. The record still contains it and the REST API remains unchanged.
- `@exensial.ui.tableHidden` keeps a field out of collection tables while retaining it in the generic create/edit form and REST representation. Use it for large source or configuration fields such as an entity definition.
- `@exensial.ui.control text|textarea|email|date|datetime|number|money|checkbox` selects a suitable editor. `email`, `date`, and `datetime` also use the standard OpenAPI `format` where applicable.
- `@exensial.relation <entity>` or `@exensial.relation <namespace>/<entity> label=<field>` declares a record relationship. The generic console reads the target collection and renders a selector using `label`, then `name`, `title`, `email`, or `id`.

The entity catalog also accepts an optional `icon` property. It is a comma-separated fallback list such as `"book,📚"`; Console clients may choose the first icon they support and safely ignore it otherwise.

The generated `id` is hidden by default in the Exensial console but is retained internally for item routes and relationship values.

## Runtime TypeScript domain code

The entity request may include a `code` string containing a TypeScript module. It must `export default` an object whose keys are CRUD operations. Each function receives a domain context and `next`, exactly like middleware: mutate `context.input` or check records before `await next()`, then react to completed generic CRUD afterwards.

```ts
export default {
  create: async (context, next) => {
    context.input.title = String(context.input.title).trim();
    await next();
  }
};
```

The context provides `records.get/create/update/remove` for other entities and `fail(message)` for a business rejection. It does not expose HTTP requests, responses, repositories, filesystem, or database drivers. This keeps domain source independent from the current in-memory repository. Read [runtime TypeScript domain modules](runtime-code.md) for the full contract and development-only security limitation.

## Disabling the catalog

The entity catalog is enabled by default. To run only modules installed in application code:

```bash
EXENSIAL_ENABLE_ENTITY_CATALOG=false npm start
```

In that mode, `/v1/entities` returns `404`.
