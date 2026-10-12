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
  "definition": "type Book = { title: string; author: string; isbn: string; available: boolean }"
}
```

Then add a book to the generated collection route:

```json
POST /v1/library/books
{
  "title": "The Left Hand of Darkness",
  "author": "Ursula K. Le Guin",
  "isbn": "978-0441478125",
  "available": true
}
```

The response includes the generated `id`. Store that id when creating a related loan:

```json
POST /v1/library/loans
{
  "bookId": "<book-id>",
  "memberId": "<member-id>",
  "borrowedAt": "2026-10-12T10:00:00.000Z",
  "dueAt": "2026-10-26T10:00:00.000Z"
}
```

By default, `bookId` and `memberId` are regular strings. Add a runtime `logic` definition when the entity must look up related records, enforce business criteria, or update another entity as part of the operation.

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

OpenAPI uses the English text, when present, in standard `title` and `description` properties. It preserves every locale in `x-exensial-localized`, so a UI can select its own language without parsing the source again.

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

This is the complete loan definition used by the local example. It is business logic received through HTTP: no library-specific TypeScript is imported by the application.

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

On create, this logic validates the DTO, looks up the book, rejects an unavailable book, writes `status: "active"`, and marks the book unavailable. On return, it accepts only an active loan with `status: "returned"` and a valid `returnedAt`, then releases the book after the loan update succeeds.

## Disabling the catalog

The entity catalog is enabled by default. To run only modules installed in application code:

```bash
EXENSIAL_ENABLE_ENTITY_CATALOG=false npm start
```

In that mode, `/v1/entities` returns `404`.
