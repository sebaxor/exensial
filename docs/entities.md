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

At this minimal stage, `bookId` and `memberId` are regular strings: Exensial stores them but does not yet enforce foreign-key relationships or automatically change `available`. Those rules belong in a trusted behavior module when the application needs them.

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

## Business behavior

The HTTP definition body never contains executable code. Application code registers trusted behavior modules at startup; an entity can select one by its stable `module` id.

This example normalizes a book title before the default create behavior, rejects a second active loan for the same member and book, and decorates the resulting record after it is saved:

```ts
import { createApp } from "./app";
import type { EntityBehaviorModule } from "./application/entity-behaviors";

const libraryLoans: EntityBehaviorModule = {
  id: "library/loans",
  operations: {
    create: async (context, next) => {
      const input = context.input as Record<string, unknown>;
      input.bookTitle = String(input.bookTitle).trim();

      const existing = await context.runtime.execute({
        apiVersion: context.request.apiVersion,
        namespace: context.request.namespace,
        entityName: context.definition.name,
        action: "list"
      }) as Array<Record<string, unknown>>;
      if (existing.some((loan) => loan.memberId === input.memberId && loan.bookTitle === input.bookTitle && !loan.returnedAt)) {
        throw new Error("This member already has this book on loan");
      }

      await next(); // runs validation-complete generic repository CRUD
      context.result = { ...(context.result as Record<string, unknown>), status: "active" }; // response decoration
    },
    delete: async (_context, next) => { await next(); }
  }
};

createApp({ behaviorModules: [libraryLoans] });
```

Register an entity that uses the module through the entity catalog:

```json
{
  "name": "loans",
  "namespace": "library",
  "module": "library/loans",
  "definition": "type Loan = { memberId: string; bookTitle: string; returnedAt?: string }"
}
```

The module runs for `POST /v1/library/loans`. Available operations are `create`, `bulkCreate`, `list`, `get`, `replace`, `update`, and `delete`.

The middleware context contains `request` (the normalized request), `definition` (schema and context), `input` (validated create/replace/update data), `current` (loaded item data), `result` (the CRUD result), and `runtime` (the same domain runtime used by every entity).

`await next()` invokes the next operation middleware and eventually generic CRUD. Call it once to extend the default behavior before and/or after it. Omitting it replaces default CRUD; set `context.result` when the operation needs to return data. Errors thrown by a behavior are normalized by the HTTP adapter. Because only server-registered module ids are accepted, no code received over HTTP is imported or executed.

## Disabling the catalog

The entity catalog is enabled by default. To run only modules installed in application code:

```bash
EXENSIAL_ENABLE_ENTITY_CATALOG=false npm start
```

In that mode, `/v1/entities` returns `404`.
