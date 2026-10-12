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
    get(entityName: string, id: string, namespace?: string): Record<string, unknown> | undefined;
    create(entityName: string, value: Record<string, unknown>, namespace?: string): Promise<Record<string, unknown>>;
    update(entityName: string, id: string, changes: Record<string, unknown>, namespace?: string): Promise<Record<string, unknown>>;
    remove(entityName: string, id: string, namespace?: string): Promise<void>;
  };
  fail(message: string): never;
};
```

`input` is mutable before `next()`, allowing normalization and derived fields. `current` is the persisted record for item operations. `records` performs domain-level CRUD against another installed entity; it does not reveal its implementation. This is the seam that will later map to a table repository, a transaction, an event stream, or another persistence mechanism.

## Example: copy-aware loans

This module is domain code, not an HTTP handler. It reserves a copy before generic loan creation and releases it after a successful return.

```ts
export default {
  create: async (context, next) => {
    const loan = context.input as Record<string, unknown>;
    loan.memberId = String(loan.memberId).trim().toLowerCase();
    const book = context.records.get("books", String(loan.bookId), "library");
    if (!book || Number(book.copiesAvailable) < 1) context.fail("Book is not available");

    await context.records.update("books", book.id, { copiesAvailable: Number(book.copiesAvailable) - 1 }, "library");
    loan.status = "active";
    await next();
  },

  update: async (context, next) => {
    const change = context.input as Record<string, unknown>;
    if (context.current?.status !== "active" || change.status !== "returned") context.fail("Only active loans may be returned");
    await next();
    const book = context.records.get("books", String(context.current?.bookId), "library")!;
    await context.records.update("books", book.id, { copiesAvailable: Number(book.copiesAvailable) + 1 }, "library");
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

Declarative `logic` remains supported for compact, portable rules. Runtime `code` is the escape hatch for domain workflows that do not yet fit that vocabulary.
