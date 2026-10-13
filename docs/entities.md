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

The relation values are generated ids, but the names remain domain-oriented. Add a runtime `logic` definition or `code` module when the entity must look up related records, enforce business criteria, or update another entity as part of the operation.

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

## Runtime business logic

`logic` is a high-level, declarative business definition sent to `POST /v1/entities` with the schema. It is installed immediately for that entity. It is not JavaScript and has no HTTP, repository, or middleware details: it describes validations, record lookups, field assignments, and patches to related entities.

Each CRUD action can have three phases:

- `before`: runs before generic CRUD; reject invalid input, look up related records, or set computed fields.
- `after`: runs only after generic CRUD succeeds; update related entities.
- `onError`: runs when generic CRUD fails after `before`; useful for compensating a reservation.

The supported rule types are:

- `assert`: validate `nonEmptyString`, `isoDate`, `equals`, or `notEquals`.
- `assertDateOrder`: require one date field to be later than another.
- `lookup`: read a record from another entity and bind it under a local name.
- `set`: assign a value to the current create/update input.
- `patch`: partially update a referenced entity.
- `reject`: stop an operation with a business error.
- `normalize`: trim text and optionally normalize its case.
- `validate`: apply grouped required, date, and positive-integer checks.
- `copy`: derive one input field from another.

For a complete runtime example with copies and loans, see the [library circulation lab](labs/library.md). Inventory and loan-state rules belong in that lab's runtime code, not in Exensial's generic rule vocabulary.

## Runtime TypeScript domain code

When a workflow cannot be expressed by the reusable `logic` vocabulary, the entity request may include a `code` string containing a TypeScript module. It must `export default` an object whose keys are CRUD operations. Each function receives a domain context and `next`, exactly like middleware: mutate `context.input` or check records before `await next()`, then react to completed generic CRUD afterwards.

```ts
export default {
  create: async (context, next) => {
    context.input.title = String(context.input.title).trim();
    await next();
  }
};
```

The context provides `records.get/create/update/remove` for other entities and `fail(message)` for a business rejection. It does not expose HTTP requests, responses, repositories, filesystem, or database drivers. This keeps domain source independent from the current in-memory repository. Read [runtime TypeScript domain modules](runtime-code.md) for the full contract and development-only security limitation.

The following is a deliberately explicit, low-level example built from `lookup`, `assert`, and `patch`. It remains useful for declarative relationships. Domain workflows such as circulation should use runtime TypeScript code instead.

```json
{
  "name": "loans",
  "namespace": "library",
  "definition": "type Loan = { bookId: string; memberId: string; borrowedAt: string; dueAt: string; returnedAt?: string; status?: string }",
  "logic": {
    "create": {
      "before": [
        { "type": "assert", "field": "bookId", "rule": "nonEmptyString" },
        { "type": "assert", "field": "memberId", "rule": "nonEmptyString" },
        { "type": "assert", "field": "borrowedAt", "rule": "isoDate" },
        { "type": "assert", "field": "dueAt", "rule": "isoDate" },
        { "type": "assertDateOrder", "earlier": "borrowedAt", "later": "dueAt" },
        { "type": "lookup", "as": "book", "entityName": "books", "namespace": "library", "idField": "bookId" },
        { "type": "assert", "source": "book", "field": "available", "rule": "equals", "value": true },
        { "type": "set", "field": "status", "value": "active" },
        { "type": "patch", "entityName": "books", "namespace": "library", "idField": "bookId", "value": { "available": false } }
      ],
      "onError": [
        { "type": "patch", "entityName": "books", "namespace": "library", "idField": "bookId", "value": { "available": true } }
      ]
    },
    "update": {
      "before": [
        { "type": "assert", "field": "status", "rule": "equals", "value": "returned" },
        { "type": "assert", "source": "current", "field": "status", "rule": "equals", "value": "active" },
        { "type": "assert", "field": "returnedAt", "rule": "isoDate" },
        { "type": "lookup", "as": "book", "entityName": "books", "namespace": "library", "idSource": "current", "idField": "bookId" }
      ],
      "after": [
        { "type": "patch", "entityName": "books", "namespace": "library", "idSource": "current", "idField": "bookId", "value": { "available": true } }
      ]
    },
    "bulkCreate": { "before": [{ "type": "reject", "message": "Bulk loans are not allowed" }] },
    "delete": { "before": [{ "type": "assert", "source": "current", "field": "status", "rule": "notEquals", "value": "active" }] }
  }
}
```

On create, this logic validates the DTO, looks up the book, writes `status: "active"`, and patches a related record. It demonstrates generic composition only; a copy-aware circulation policy belongs in a runtime TypeScript domain module.

## Disabling the catalog

The entity catalog is enabled by default. To run only modules installed in application code:

```bash
EXENSIAL_ENABLE_ENTITY_CATALOG=false npm start
```

In that mode, `/v1/entities` returns `404`.
