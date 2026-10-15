import assert from "node:assert/strict";
import test from "node:test";
import { acceptsGridResponse, createConsoleResources, findRelationResource, gridRenderState, mergeViewManifest, relationCollectionPath, withGridFilter } from "../src/ui/console-model";

const operation = { tags: ["library.books"] };
const document = {
  components: { schemas: {
    "library.books": { title: "Books", properties: { id: { type: "string" }, title: { type: "string" } }, "x-exensial-context": { group: "Library" } },
    "library.loans": { title: "Loans", properties: { id: { type: "string" }, bookId: { type: "string" } }, "x-exensial-context": { group: "Library" } }
  } },
  paths: {
    "/v1/library/books": { get: operation }, "/v1/library/books/{id}": {},
    "/v1/library/loans": { get: { tags: ["library.loans"] } }, "/v1/library/loans/{id}": {}
  }
};

test("console happy path keeps the CRUD relation endpoint when a QueryView replaces a list", () => {
  const resources = createConsoleResources(document, () => true);
  const merged = mergeViewManifest(resources, {
    views: [{ viewId: "Library_Book_QueryView", name: "Library book catalog", kind: "query", target: { namespace: "library", entity: "books", slot: "query" } }],
    menus: [{ viewId: "Library_Book_QueryView", parentId: "Library", position: 10, visible: true }]
  });

  const books = findRelationResource(merged, { namespace: "library", entity: "books" });
  assert.ok(books);
  assert.equal(books.path, "/v1/views/Library_Book_QueryView/data");
  assert.equal(books.entityPath, "/v1/library/books");
  assert.equal(relationCollectionPath(books), "/v1/library/books?page=1&perPage=25");
  assert.equal(findRelationResource(merged, { namespace: "library", entity: "members" }), undefined);
});

test("console navigation respects generated resources and menu visibility overrides", () => {
  const resources = createConsoleResources(document, () => true);
  const merged = mergeViewManifest(resources, { views: [], menus: [{ viewId: "entity:library.loans:query", visible: false }] });
  assert.equal(merged.some((resource) => resource.path === "/v1/library/loans"), false);
  assert.equal(merged.some((resource) => resource.path === "/v1/library/books"), true);
});

test("grid keeps its structural state when a server-side filter has no matches", () => {
  assert.equal(gridRenderState(4), "records");
  assert.equal(gridRenderState(0), "empty");
});

test("grid filters replace only their own field and keep independent filters", () => {
  const initial = [{ field: "title", value: "left" }, { field: "author", value: "le guin" }];
  assert.deepEqual(withGridFilter(initial, "title", { field: "title", value: "kindred" }), [{ field: "author", value: "le guin" }, { field: "title", value: "kindred" }]);
  assert.deepEqual(withGridFilter(initial, "author"), [{ field: "title", value: "left" }]);
});

test("a delayed grid response cannot replace the latest response", () => {
  assert.equal(acceptsGridResponse(8, 8), true);
  assert.equal(acceptsGridResponse(7, 8), false);
});
