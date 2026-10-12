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
    assert.ok(requests.some((request: { entityName: string }) => request.entityName === "authors"));
    assert.ok(responses.some((response: { status: number }) => response.status === 201));
  });
});

test("generates localized OpenAPI documentation from JSDoc entity metadata", async () => {
  await withApi(async (baseUrl) => {
    const definition = `/**\n * @zfc.title en Products\n * @zfc.title es Productos\n * @zfc.description en A product catalog\n */\ntype Product = {\n  /** @zfc.title en Title */\n  name: string;\n}`;
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "documented-products", definition }) });
    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    const schema = openapi.components.schemas["documented-products"];
    assert.equal(schema.title, "Products");
    assert.equal(schema["x-zfc-localized"].title.es, "Productos");
    assert.ok(openapi.paths["/v1/documented-products"]);
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
    const created = await fetch(`${baseUrl}/v1/announcements`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "  hello  " })
    });
    assert.equal((await created.json()).title, "HELLO");

    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    assert.deepEqual(openapi.components.schemas.announcements["x-exensial-context"], {
      namespace: "demo.content", module: "example/normalize-title", operations: ["create"]
    });
  }, { behaviorModules: [normalizeTitle] });
});

test("can disable the entity catalog layer", async () => {
  await withApi(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/v1/entities`)).status, 404);
  }, { enableEntityCatalog: false });
});
