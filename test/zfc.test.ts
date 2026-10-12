import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApp } from "../src/app";
import type { AppOptions } from "../src/app";
import type { EntityBehaviorModule } from "../src/application/entity-behaviors";

async function withApi(run: (baseUrl: string) => Promise<void>, options: AppOptions = {}) {
  const server = createServer(createApp(options));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start server");
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("creates an entity from a TypeScript type and performs its CRUD", async () => {
  await withApi(async (baseUrl) => {
    const entity = await fetch(`${baseUrl}/v1/entities`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "catalog-items", definition: "type CatalogItem = { title: string; pages: number; published?: boolean }" })
    });
    assert.equal(entity.status, 201);
    const entityRecord = await entity.json();
    assert.equal(entityRecord.name, "catalog-items");

    const created = await fetch(`${baseUrl}/v1/catalog-items`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Sample", pages: 412 })
    });
    const item = await created.json();
    assert.equal(created.status, 201);
    assert.ok(item.id);
    assert.deepEqual(await (await fetch(`${baseUrl}/v1/catalog-items`)).json(), [item]);

    const updated = await fetch(`${baseUrl}/v1/catalog-items/${item.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pages: 500, published: true })
    });
    assert.deepEqual(await updated.json(), { ...item, pages: 500, published: true });
    assert.equal((await fetch(`${baseUrl}/v1/catalog-items/${item.id}`, { method: "DELETE" })).status, 204);
  });
});

test("returns correct errors for duplicate entities and invalid record routes", async () => {
  await withApi(async (baseUrl) => {
    const entity = { name: "tasks", definition: "type Task = { title: string }" };
    const createEntity = () => fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entity) });
    assert.equal((await createEntity()).status, 201);
    assert.equal((await createEntity()).status, 409);
    assert.equal((await fetch(`${baseUrl}/v1/tasks/missing`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "not json" })).status, 404);
  });
});

test("updates and removes a dynamic entity through the same REST CRUD", async () => {
  await withApi(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "notes", definition: "type Note = { body: string }" }) });
    const entity = await created.json();
    assert.equal((await fetch(`${baseUrl}/v1/entities/${entity.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ definition: "type Note = { body: string; pinned?: boolean }" }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "Hello", pinned: true }) })).status, 201);
    assert.equal((await fetch(`${baseUrl}/v1/entities/${entity.id}`, { method: "DELETE" })).status, 204);
  });
});

test("captures versioned REST patterns and bulk-import payloads", async () => {
  await withApi(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "import-items", definition: "type ImportItem = { name: string; author: string }" }) });
    const imported = await fetch(`${baseUrl}/v1/import-items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ name: "One", author: "A" }, { name: "Two", author: "B" }]) });
    const { items } = await imported.json();
    assert.equal(imported.status, 201);
    assert.equal(items.length, 2);
    assert.equal((await fetch(`${baseUrl}/v1/import-items/${items[0].id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Updated", author: "A" }) })).status, 200);
  });
});

test("persists normalized requests and responses as system entities", async () => {
  await withApi(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "authors", definition: "type Author = { name: string }" }) });
    assert.equal((await fetch(`${baseUrl}/v1/authors`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sample" }) })).status, 201);
    const requests = await (await fetch(`${baseUrl}/v1/requests`)).json();
    const responses = await (await fetch(`${baseUrl}/v1/responses`)).json();
    const request = requests.find((item: { entityName: string }) => item.entityName === "authors");
    assert.ok(request);
    const response = responses.find((item: { id: string }) => item.id === request.id);
    assert.ok(response);
    assert.equal(response.status, 201);
    assert.ok(Number.isFinite(Date.parse(request.receivedAt)));
    assert.ok(Number.isFinite(Date.parse(response.completedAt)));
    assert.equal(typeof response.durationMs, "number");
    assert.ok(response.durationMs >= 0);
    assert.equal("requestId" in response, false);
  });
});

test("generates localized OpenAPI documentation from Exensial JSDoc metadata", async () => {
  await withApi(async (baseUrl) => {
    const definition = `/**\n * @exensial.title en Products\n * @exensial.title es Productos\n * @exensial.description en A product catalog\n */\ntype Product = {\n  /** @exensial.title en Title */\n  name: string;\n}`;
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "documented-products", definition }) });
    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    assert.equal(openapi.info.title, "Exensial API");
    assert.match(openapi.info.description, /Start here: define a collection/);
    assert.match(openapi.info.description, /This creates a namespaced task collection/);
    assert.equal(openapi.components.schemas.entities.title, "Entity catalog");
    const schema = openapi.components.schemas["documented-products"];
    assert.equal(schema.title, "Products");
    assert.equal(schema["x-exensial-localized"].title.es, "Productos");
    assert.ok(openapi.paths["/v1/documented-products"]);
    const collection = openapi.paths["/v1/documented-products"];
    assert.equal(collection.get.operationId, "listDocumentedProducts");
    assert.match(collection.get.description, /Returns every record/);
    assert.deepEqual(collection.post.requestBody.content["application/json"].examples.one.value, { name: "Example name" });
    assert.deepEqual(collection.get.responses[200].content["application/json"].example, [{ id: "550e8400-e29b-41d4-a716-446655440000", name: "Example name" }]);
    assert.match(openapi.paths["/v1/documented-products/{id}"].patch.description, /Updates only the supplied fields/);
    assert.match(await (await fetch(`${baseUrl}/docs`)).text(), /SwaggerUIBundle/);
  });
});

test("binds trusted operation middleware to a runtime-defined entity", async () => {
  const normalizeTitle: EntityBehaviorModule = {
    id: "example/normalize-title",
    operations: {
      create: async (context, next) => {
        const input = context.input as Record<string, unknown>;
        input.title = String(input.title).trim().toUpperCase();
        await next();
      },
      list: async (context) => {
        context.result = [];
      }
    }
  };
  await withApi(async (baseUrl) => {
    const entity = await fetch(`${baseUrl}/v1/entities`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "announcements",
        namespace: "demo.content",
        module: "example/normalize-title",
        definition: "type Announcement = { title: string }"
      })
    });
    assert.equal(entity.status, 201);
    const created = await fetch(`${baseUrl}/v1/demo.content/announcements`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "  hello  " })
    });
    assert.equal((await created.json()).title, "HELLO");
    assert.deepEqual(await (await fetch(`${baseUrl}/v1/demo.content/announcements`)).json(), []);
    assert.equal((await fetch(`${baseUrl}/v1/announcements`)).status, 404);
    const requests = await (await fetch(`${baseUrl}/v1/requests`)).json();
    assert.ok(requests.some((request: { namespace?: string; entityName: string }) => request.namespace === "demo.content" && request.entityName === "announcements"));

    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    assert.deepEqual(openapi.components.schemas["demo.content.announcements"]["x-exensial-context"], {
      namespace: "demo.content", module: "example/normalize-title", operations: ["create", "list"]
    });
    assert.ok(openapi.paths["/v1/demo.content/announcements"]);
  }, { behaviorModules: [normalizeTitle] });
});

test("allows equal entity names in separate namespaces", async () => {
  await withApi(async (baseUrl) => {
    for (const namespace of ["acme.sales", "acme.support"]) {
      const response = await fetch(`${baseUrl}/v1/entities`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "tickets", namespace, definition: "type Ticket = { subject: string }" })
      });
      assert.equal(response.status, 201);
    }
    assert.equal((await fetch(`${baseUrl}/v1/acme.sales/tickets`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: "Invoice" })
    })).status, 201);
    assert.equal((await fetch(`${baseUrl}/v1/acme.support/tickets`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: "Login" })
    })).status, 201);
    assert.equal((await (await fetch(`${baseUrl}/v1/acme.sales/tickets`)).json()).length, 1);
    assert.equal((await (await fetch(`${baseUrl}/v1/acme.support/tickets`)).json()).length, 1);
  });
});

test("installs availability reservation rules through runtime logic", async () => {
  await withApi(async (baseUrl) => {
    const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    await post("/v1/entities", {
      name: "books", namespace: "library",
      definition: "type Book = { title: string; copiesTotal: number; copiesAvailable?: number }",
      logic: {
        create: { before: [
          { type: "normalize", fields: ["title"] },
          { type: "validate", required: ["title"], positiveIntegers: ["copiesTotal"] },
          { type: "copy", from: "copiesTotal", to: "copiesAvailable" }
        ] }
      }
    });
    const book = await (await post("/v1/library/books", { title: "  A Wizard of Earthsea  ", copiesTotal: 1 })).json();
    assert.equal(book.title, "A Wizard of Earthsea");
    assert.equal(book.copiesAvailable, 1);
    const imported = await post("/v1/library/books", [{ title: "  Tehanu  ", copiesTotal: 2 }]);
    assert.equal(imported.status, 201);
    const importedBook = (await imported.json()).items[0];
    assert.equal(importedBook.title, "Tehanu");
    assert.equal(importedBook.copiesAvailable, 2);
    assert.ok(importedBook.id);
    const loanDefinition = await post("/v1/entities", {
      name: "loans",
      namespace: "library",
      logic: {
        create: {
          before: [
            { type: "normalize", fields: ["memberId"] },
            { type: "validate", required: ["bookId", "memberId", "borrowedAt", "dueAt"], isoDates: ["borrowedAt", "dueAt"], dateOrder: { earlier: "borrowedAt", later: "dueAt" } },
            { type: "set", field: "status", value: "active" },
            { type: "reserve", entityName: "books", namespace: "library", idField: "bookId", field: "copiesAvailable" }
          ]
        },
        update: {
          before: [
            { type: "transition", field: "status", from: "active", to: "returned", required: ["returnedAt"], isoDates: ["returnedAt"] }
          ],
          after: [{ type: "release", entityName: "books", namespace: "library", idSource: "current", idField: "bookId", field: "copiesAvailable", capacityField: "copiesTotal" }]
        },
        bulkCreate: { before: [{ type: "reject", message: "Bulk loans are not allowed" }] },
        delete: { before: [{ type: "assert", source: "current", field: "status", rule: "notEquals", value: "active", message: "Active loans cannot be deleted" }] }
      },
      definition: "type Loan = { bookId: string; memberId: string; borrowedAt: string; dueAt: string; returnedAt?: string; status?: string }"
    });
    assert.equal(loanDefinition.status, 201);

    assert.equal((await post("/v1/library/loans", {
      bookId: book.id, memberId: " ", borrowedAt: "2026-10-12T10:00:00.000Z", dueAt: "2026-10-26T10:00:00.000Z"
    })).status, 400);
    const created = await post("/v1/library/loans", {
      bookId: book.id, memberId: "member-1", borrowedAt: "2026-10-12T10:00:00.000Z", dueAt: "2026-10-26T10:00:00.000Z"
    });
    const loan = await created.json();
    assert.equal(created.status, 201);
    assert.equal(loan.status, "active");
    assert.equal((await (await fetch(`${baseUrl}/v1/library/books/${book.id}`)).json()).copiesAvailable, 0);

    assert.equal((await post("/v1/library/loans", {
      bookId: book.id, memberId: "member-2", borrowedAt: "2026-10-12T10:00:00.000Z", dueAt: "2026-10-26T10:00:00.000Z"
    })).status, 400);
    assert.equal((await fetch(`${baseUrl}/v1/library/loans/${loan.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "returned", returnedAt: "2026-10-15T12:00:00.000Z" })
    })).status, 200);
    assert.equal((await (await fetch(`${baseUrl}/v1/library/books/${book.id}`)).json()).copiesAvailable, 1);
    assert.equal((await fetch(`${baseUrl}/v1/library/loans/${loan.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "returned", returnedAt: "2026-10-15T12:00:00.000Z" })
    })).status, 400);
  });
});

test("can disable the entity catalog layer", async () => {
  await withApi(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/v1/entities`)).status, 404);
  }, { enableEntityCatalog: false });
});
