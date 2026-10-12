import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createApp } from "../src/app";

async function withApi(run: (baseUrl: string) => Promise<void>) {
  const server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start server");

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("creates an entity from a TypeScript type and performs its CRUD", async () => {
  await withApi(async (baseUrl) => {
    const entity = await fetch(`${baseUrl}/v1/entities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "books",
        definition: "type Book = { title: string; pages: number; published?: boolean }"
      })
    });
    assert.equal(entity.status, 201);
    const entityRecord = await entity.json();
    assert.equal(entityRecord.name, "books");
    assert.ok(entityRecord.id);

    const created = await fetch(`${baseUrl}/v1/books`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Dune", pages: 412 })
    });
    assert.equal(created.status, 201);
    const book = await created.json();
    assert.equal(book.title, "Dune");
    assert.equal(book.pages, 412);
    assert.ok(book.id);

    const listed = await fetch(`${baseUrl}/v1/books`);
    assert.deepEqual(await listed.json(), [book]);

    const updated = await fetch(`${baseUrl}/v1/books/${book.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pages: 500, published: true })
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { ...book, pages: 500, published: true });

    const removed = await fetch(`${baseUrl}/v1/books/${book.id}`, { method: "DELETE" });
    assert.equal(removed.status, 204);
    assert.deepEqual(await (await fetch(`${baseUrl}/v1/books`)).json(), []);
  });
});

test("returns correct errors for duplicate entities and invalid record routes", async () => {
  await withApi(async (baseUrl) => {
    const entity = { name: "tasks", definition: "type Task = { title: string }" };
    const createEntity = () => fetch(`${baseUrl}/v1/entities`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entity)
    });
    assert.equal((await createEntity()).status, 201);
    assert.equal((await createEntity()).status, 409);
    assert.equal((await fetch(`${baseUrl}/v1/tasks/missing`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: "not json"
    })).status, 404);
    assert.equal((await fetch(`${baseUrl}/v1/tasks/missing/extra`)).status, 404);
  });
});

test("updates and removes a dynamic entity through the same REST CRUD", async () => {
  await withApi(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/v1/entities`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "notes", definition: "type Note = { body: string }" })
    });
    const entity = await created.json();

    const updated = await fetch(`${baseUrl}/v1/entities/${entity.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ definition: "type Note = { body: string; pinned?: boolean }" })
    });
    assert.equal(updated.status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/notes`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "Hello", pinned: true })
    })).status, 201);

    assert.equal((await fetch(`${baseUrl}/v1/entities/${entity.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await fetch(`${baseUrl}/v1/notes`)).status, 404);
  });
});

test("captures versioned REST patterns and bulk-import payloads", async () => {
  await withApi(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/entities`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "books", definition: "type Book = { name: string; author: string }" })
    });

    const imported = await fetch(`${baseUrl}/v1/books`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify([{ name: "Dune", author: "Frank Herbert" }, { name: "Kindred", author: "Octavia Butler" }])
    });
    assert.equal(imported.status, 201);
    const { items } = await imported.json();
    assert.equal(items.length, 2);

    const replaced = await fetch(`${baseUrl}/v1/books/${items[0].id}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dune Messiah", author: "Frank Herbert" })
    });
    assert.equal(replaced.status, 200);
    assert.equal((await replaced.json()).name, "Dune Messiah");
    assert.equal((await fetch(`${baseUrl}/books`)).status, 404);
  });
});

test("persists normalized requests and responses as system entities", async () => {
  await withApi(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/entities`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "authors", definition: "type Author = { name: string }" })
    });
    const created = await fetch(`${baseUrl}/v1/authors`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Ursula Le Guin" })
    });
    assert.equal(created.status, 201);

    const requests = await (await fetch(`${baseUrl}/v1/requests`)).json();
    assert.ok(requests.some((request: { entityName: string; action: string }) => request.entityName === "authors" && request.action === "create"));

    const responses = await (await fetch(`${baseUrl}/v1/responses`)).json();
    assert.ok(responses.some((response: { status: number }) => response.status === 201));
  });
});

test("generates localized OpenAPI documentation from JSDoc entity metadata", async () => {
  await withApi(async (baseUrl) => {
    const definition = `/**
 * @zfc.title en Books
 * @zfc.title es Libros
 * @zfc.description en A catalog of books
 */
type Book = {
  /** @zfc.title en Title */
  name: string;
}`;
    const created = await fetch(`${baseUrl}/v1/entities`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "books", definition })
    });
    assert.equal(created.status, 201);

    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    const schema = openapi.components.schemas.books;
    assert.equal(schema.title, "Books");
    assert.equal(schema.description, "A catalog of books");
    assert.equal(schema["x-zfc-localized"].title.es, "Libros");
    assert.equal(schema.properties.name.title, "Title");
    assert.ok(openapi.paths["/v1/books"]);

    const docs = await fetch(`${baseUrl}/docs`);
    assert.equal(docs.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await docs.text(), /SwaggerUIBundle/);
  });
});
