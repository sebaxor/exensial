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
    const entity = await fetch(`${baseUrl}/entities`, {
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

    const created = await fetch(`${baseUrl}/books`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Dune", pages: 412 })
    });
    assert.equal(created.status, 201);
    const book = await created.json();
    assert.equal(book.title, "Dune");
    assert.equal(book.pages, 412);
    assert.ok(book.id);

    const listed = await fetch(`${baseUrl}/books`);
    assert.deepEqual(await listed.json(), [book]);

    const updated = await fetch(`${baseUrl}/books/${book.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pages: 500, published: true })
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { ...book, pages: 500, published: true });

    const removed = await fetch(`${baseUrl}/books/${book.id}`, { method: "DELETE" });
    assert.equal(removed.status, 204);
    assert.deepEqual(await (await fetch(`${baseUrl}/books`)).json(), []);
  });
});

test("returns correct errors for duplicate entities and invalid record routes", async () => {
  await withApi(async (baseUrl) => {
    const entity = { name: "tasks", definition: "type Task = { title: string }" };
    const createEntity = () => fetch(`${baseUrl}/entities`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entity)
    });
    assert.equal((await createEntity()).status, 201);
    assert.equal((await createEntity()).status, 409);
    assert.equal((await fetch(`${baseUrl}/tasks/missing`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: "not json"
    })).status, 404);
    assert.equal((await fetch(`${baseUrl}/tasks/missing/extra`)).status, 404);
  });
});

test("updates and removes a dynamic entity through the same REST CRUD", async () => {
  await withApi(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/entities`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "notes", definition: "type Note = { body: string }" })
    });
    const entity = await created.json();

    const updated = await fetch(`${baseUrl}/entities/${entity.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ definition: "type Note = { body: string; pinned?: boolean }" })
    });
    assert.equal(updated.status, 200);
    assert.equal((await fetch(`${baseUrl}/notes`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "Hello", pinned: true })
    })).status, 201);

    assert.equal((await fetch(`${baseUrl}/entities/${entity.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await fetch(`${baseUrl}/notes`)).status, 404);
  });
});
