# Runtime TypeScript domain modules

> Experimental development capability. Exensial executes submitted code in the server process. It is suitable only for a controlled local environment; it is **not** a security boundary and must never accept untrusted clients.

An entity may include `code`, a TypeScript module string, in the same `POST /v1/entities` request that contains its type definition. The module must use `export default` and export one or more CRUD-operation functions.

```ts
export default {
  create: async (context, next) => {
    // domain rules before persistence
    await next();
    // domain rules after persistence
  }
};
```

Supported operation names are `create`, `bulkCreate`, `list`, `get`, `replace`, `update`, and `delete`. A function is ordinary asynchronous middleware: calling `await next()` continues to generic CRUD; omitting it replaces that operation by assigning `context.result` or simply finishing.

## Business context

The function receives `context` and `next`. `context` intentionally exposes a stable business contract rather than HTTP objects, repository instances, or database drivers:

```ts
type BusinessContext = {
  action: "create" | "bulkCreate" | "list" | "get" | "replace" | "update" | "delete";
  input?: Record<string, unknown> | Record<string, unknown>[];
  current?: Record<string, unknown> & { id: string };
  result?: Record<string, unknown> | Array<Record<string, unknown>>;
  records: {
    count(entityName: string, namespace?: string): number;
    get(entityName: string, id: string, namespace?: string): Record<string, unknown> | undefined;
    findBy(entityName: string, field: string, value: unknown, namespace?: string): Array<Record<string, unknown>>;
    create(entityName: string, value: Record<string, unknown>, namespace?: string): Promise<Record<string, unknown>>;
    update(entityName: string, id: string, changes: Record<string, unknown>, namespace?: string): Promise<Record<string, unknown>>;
    remove(entityName: string, id: string, namespace?: string): Promise<void>;
  };
  collection(entityName: string, namespace?: string): {
    count(): number;
    get(id: string): Record<string, unknown> | undefined;
    findBy(field: string, value: unknown): Array<Record<string, unknown>>;
    create(value: Record<string, unknown>): Promise<Record<string, unknown>>;
    update(id: string, changes: Record<string, unknown>): Promise<Record<string, unknown>>;
    remove(id: string): Promise<void>;
  };
  /** One argument is a literal fallback; two arguments resolve a localization key first. */
  fail(key: string, fallback?: string): never;
};
```

`input` is mutable before `next()`, allowing normalization and derived fields. `current` is the persisted record for item operations. `collection("books", "library")` is the readable shorthand for working with one related collection; `records` is the equivalent lower-level form. `findBy(field, value)` is an equality lookup for rules such as unique associations; a future table repository can translate it to an indexed query. Neither exposes persistence implementation. This is the seam that will later map to a table repository, a transaction, an event stream, or another persistence mechanism.

Because `input` is mutable, a domain module may also enforce ownership of workflow fields. For example, a loan's `create` operation can use `delete loan.returnedAt` and set `loan.status = "active"`; only its return transition may later set `returnedAt` during `update`.

## Localized domain failures

Use a stable key plus an English fallback for any domain message that should be shown to people. Exensial resolves the key against the runtime `localizations` entity using `?lang=<locale>` or the request's `Accept-Language` header, then falls back to English. This keeps text out of infrastructure while allowing a lab or installed domain to publish its own translations through REST.

```ts
if (context.current?.status === "active") {
  context.fail(
    "library.loans.error.activeCannotDelete",
    "Active loans cannot be deleted"
  );
}
```

The corresponding domain installation creates ordinary localization records such as `{ locale: "es", key: "library.loans.error.activeCannotDelete", value: "Los préstamos activos no se pueden eliminar." }`. The single-argument form, `context.fail("Message")`, remains compatible but cannot be translated by key.

## Example: copy-aware loans

This module is domain code, not an HTTP handler. It reserves a copy before generic loan creation and releases it after a successful return.

```ts
export default {
  create: async (context, next) => {
    const loan = context.input as Record<string, unknown>;
    const books = context.collection("books", "library");
    const book = books.get(String(loan.book));
    if (!book || Number(book.copiesAvailable) < 1) context.fail("Book is not available");

    await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) - 1 });
    loan.status = "active";
    await next();
  },

  update: async (context, next) => {
    const change = context.input as Record<string, unknown>;
    if (context.current?.status !== "active" || change.status !== "returned") context.fail("Only active loans may be returned");
    await next();
    const books = context.collection("books", "library");
    const book = books.get(String(context.current?.book))!;
    await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) + 1 });
  }
};
```

## Installation

`code` is a JSON string. This short example normalizes a title and then delegates to generic create:

```bash
curl -X POST http://localhost:3000/v1/entities \
  -H 'content-type: application/json' \
  -d '{"name":"notes","definition":"type Note = { title: string }","code":"export default { create: async (context, next) => { context.input.title = String(context.input.title).trim(); await next(); } }"}'
```

The entity catalog stores source as the entity's `code` field and compiles it while installing or updating the entity. TypeScript is transpiled for execution, but this MVP does not perform complete semantic type checking of submitted source and does not allow imports.

## Execution and persistence roadmap

Today Exensial uses Node's VM API only to load a module without injecting Node globals into its explicit context. That does **not** safely isolate hostile JavaScript. A future production executor must replace this development compiler with a restricted language/AST or an isolated worker sandbox with explicit capability grants.

Today each `records.*` call delegates to the in-memory runtime, so multi-entity changes are not atomic. The important preserved boundary is that domain code calls the `records` facade instead of an `InMemoryRepository`. When repositories become tables, the facade can run inside one database transaction and map entity definitions to tables without changing domain source.

`count()` is available on `records` and on a bound `collection`. Runtime domain code deliberately does not receive arbitrary query execution. Read query engines are HTTP capabilities that validate and compile their syntax at the transport boundary before calling the repository; submitted query text is never executed as code.

Runtime `code` is the single business-behavior mechanism for dynamic entities. This keeps each runtime definition focused on its domain source instead of splitting behavior between multiple DSLs and server-registered modules.
