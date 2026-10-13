import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApp } from "../src/app";
import type { AppOptions } from "../src/app";
import { hashPassword } from "../src/application/security";

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

test("bootstraps every system entity through the entity catalog", async () => {
  await withApi(async (baseUrl) => {
    const catalog = await (await fetch(`${baseUrl}/v1/entities?perPage=100`)).json() as Array<{ id: string; name: string; definition: string }>;
    assert.deepEqual(new Set(catalog.map((item) => item.name)), new Set(["entities", "localizations", "requests", "responses", "roles", "users", "userRoles", "permissions"]));
    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    assert.equal(openapi.components.schemas.users.properties.active.default, true);
    const catalogEntry = catalog.find((item) => item.name === "entities")!;
    assert.equal((await fetch(`${baseUrl}/v1/entities/${catalogEntry.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ definition: catalogEntry.definition })
    })).status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/entities`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "catalog-survives-update", definition: "type CatalogSurvivesUpdate = { name: string }" })
    })).status, 201);
    const created = await fetch(`${baseUrl}/v1/users`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "defaulted", password: "password123", roles: [] })
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).active, true);
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

test("enforces endpoint permissions while leaving unconfigured endpoints anonymous", async () => {
  await withApi(async (baseUrl) => {
    const json = { "content-type": "application/json" };
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: json, body: JSON.stringify({ name: "books", namespace: "library", definition: "type Book = { title: string }" }) });
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: json, body: JSON.stringify({ name: "members", namespace: "library", definition: "type Member = { name: string }" }) });
    const roles = await (await fetch(`${baseUrl}/v1/roles`, { method: "POST", headers: json, body: JSON.stringify([{ name: "anonymous" }, { name: "reader" }, { name: "admin" }]) })).json() as { items: Array<{ id: string; name: string }> };
    const roleId = Object.fromEntries(roles.items.map((role) => [role.name, role.id]));
    await fetch(`${baseUrl}/v1/users`, { method: "POST", headers: json, body: JSON.stringify([{ username: "admin", passwordHash: hashPassword("secret"), roles: ["admin"], active: true }, { username: "reader", passwordHash: hashPassword("reader-secret"), roles: ["reader"], active: true }]) });
    await fetch(`${baseUrl}/v1/permissions`, { method: "POST", headers: json, body: JSON.stringify([{ role: roleId.anonymous, method: "GET", path: "/v1/library/books*", decision: "allow" }, { role: roleId.reader, method: "GET", path: "/v1/*", decision: "allow" }, { role: roleId.admin, method: "POST", path: "/v1/library/books*", decision: "allow" }, { role: roleId.admin, method: "GET", path: "/v1/users*", decision: "allow" }, { role: roleId.admin, method: "GET", path: "/v1/query/exensial/library/members*", decision: "allow" }]) });
    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    assert.equal(openapi.paths["/v1/library/books"].post.security[0].bearerAuth.length, 0);
    assert.equal(openapi.paths["/v1/library/books"].post["x-exensial-authorization"].rules[0].role, "admin");
    assert.equal(openapi.paths["/v1/library/books"].get["x-exensial-authorization"].anonymous, true);
    assert.equal((await fetch(`${baseUrl}/v1/library/books`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/library/members`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/v1/library/books`, { method: "POST", headers: json, body: JSON.stringify({ title: "Blocked" }) })).status, 401);
    const readerLogin = await fetch(`${baseUrl}/v1/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ username: "reader", password: "reader-secret" }) });
    const { accessToken: readerToken } = await readerLogin.json() as { accessToken: string };
    assert.equal((await fetch(`${baseUrl}/v1/library/members`, { headers: { authorization: `Bearer ${readerToken}` } })).status, 200);
    const login = await fetch(`${baseUrl}/v1/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ username: "admin", password: "secret" }) });
    assert.equal(login.status, 200);
    const { accessToken } = await login.json() as { accessToken: string };
    assert.equal((await fetch(`${baseUrl}/v1/library/books`, { headers: { authorization: `Bearer ${accessToken}` } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/query/exensial/library/members`, { headers: { authorization: `Bearer ${accessToken}` } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/library/books`, { method: "POST", headers: { ...json, authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ title: "Allowed" }) })).status, 201);
    const profile = await (await fetch(`${baseUrl}/v1/auth/profile`, { headers: { authorization: `Bearer ${accessToken}` } })).json() as { username: string };
    assert.equal(profile.username, "admin");
    const profileUpdate = await (await fetch(`${baseUrl}/v1/auth/profile`, { method: "PATCH", headers: { ...json, authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ username: "administrator", email: "administrator@example.com" }) })).json() as { accessToken: string; user: { email: string } };
    assert.equal(profileUpdate.user.email, "administrator@example.com");
    const users = await (await fetch(`${baseUrl}/v1/users`, { headers: { authorization: `Bearer ${accessToken}` } })).json() as Array<Record<string, unknown>>;
    assert.equal("passwordHash" in users[0], false);
    assert.equal((await fetch(`${baseUrl}/v1/auth/change-password`, { method: "POST", headers: { ...json, authorization: `Bearer ${profileUpdate.accessToken}` }, body: JSON.stringify({ currentPassword: "secret", newPassword: "new-secret" }) })).status, 204);
    assert.equal((await fetch(`${baseUrl}/v1/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ username: "administrator", password: "new-secret" }) })).status, 200);
  });
});

test("reports validation errors with the offending field name", async () => {
  await withApi(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "notes", definition: "type Note = { title: string }" }) });
    const response = await fetch(`${baseUrl}/v1/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: null }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Invalid value for field "title": expected string.');
  });
});

test("applies JSDoc defaults on creation and exposes standard OpenAPI defaults", async () => {
  await withApi(async (baseUrl) => {
    const definition = `type Task = {
  title: string;
  /** @exensial.default "draft" */
  status: string;
  /** @exensial.default false */
  completed?: boolean;
  /** @exensial.default 3 */
  priority?: number;
  /** @exensial.default {"labels":[]} */
  metadata?: json;
}`;
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "defaulted-tasks", definition }) });
    const created = await fetch(`${baseUrl}/v1/defaulted-tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Write documentation" }) });
    assert.equal(created.status, 201);
    const record = await created.json() as Record<string, unknown>;
    assert.equal(typeof record.id, "string");
    assert.deepEqual({ ...record, id: undefined }, { id: undefined, title: "Write documentation", status: "draft", completed: false, priority: 3, metadata: { labels: [] } });
    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    const properties = openapi.components.schemas["defaulted-tasks"].properties;
    assert.equal(properties.status.default, "draft");
    assert.equal(properties.completed.default, false);
    assert.equal(properties.priority.default, 3);
    assert.deepEqual(properties.metadata.default, { labels: [] });
    assert.equal(openapi.components.schemas["defaulted-tasks"].required.includes("status"), false);
  });
});

test("validates fixed string choices and publishes them as an OpenAPI enum", async () => {
  await withApi(async (baseUrl) => {
    const definition = `type Permission = {
  /** @exensial.enum allow deny */
  decision: string;
}`;
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "test-permissions", definition }) });
    const headers = { "content-type": "application/json" };
    assert.equal((await fetch(`${baseUrl}/v1/test-permissions`, { method: "POST", headers, body: JSON.stringify({ decision: "allow" }) })).status, 201);
    const rejected = await fetch(`${baseUrl}/v1/test-permissions`, { method: "POST", headers, body: JSON.stringify({ decision: "maybe" }) });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error, 'Invalid value for field "decision": expected one of allow, deny.');
    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    assert.deepEqual(openapi.components.schemas["test-permissions"].properties.decision.enum, ["allow", "deny"]);
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
    const definition = `/**\n * @exensial.title en Products\n * @exensial.title es Productos\n * @exensial.description en A product catalog\n * @exensial.operation list en List products\n * @exensial.operation list es Listar productos\n */\ntype Product = {\n  /** @exensial.title en Title */\n  name: string;\n  /**\n   * @exensial.ui.hidden\n   */\n  internalCode?: string;\n  /**\n   * @exensial.ui.control money\n   */\n  price?: number;\n  /**\n   * @exensial.relation catalog/categories label=name\n   */\n  categoryId?: string;\n}`;
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "documented-products", definition }) });
    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    assert.equal(openapi.info.title, "Exensial API");
    assert.match(openapi.info.description, /Start here: define a collection/);
    assert.match(openapi.info.description, /This creates a namespaced task collection/);
    const spanishOpenapi = await (await fetch(`${baseUrl}/openapi.json?lang=es`)).json();
    assert.match(spanishOpenapi.info.description, /Empieza aquí: define una colección/);
    assert.match(spanishOpenapi.info.description, /Esto crea una colección de tareas/);
    assert.equal(spanishOpenapi.paths["/v1/auth/login"].post.summary, "Crear una sesión JWT local");
    assert.match(spanishOpenapi.paths["/v1/auth/login"].post.description, /Valida un usuario local/);
    const spanishQuery = spanishOpenapi.paths["/v1/query/exensial/documented-products"].get;
    assert.match(spanishQuery.description, /capacidad opcional ExensialQuery/);
    assert.match(spanishQuery.parameters.find((parameter: { name: string }) => parameter.name === "$filter").description, /Ejemplos:/);
    assert.match(spanishQuery.parameters.find((parameter: { name: string }) => parameter.name === "$top").description, /Máximo de registros/);
    assert.match(spanishOpenapi.components.schemas.localizations.description, /Traducciones en tiempo de ejecución/);
    assert.equal(spanishOpenapi.paths["/v1/documented-products"].get.summary, "Listar productos");
    assert.equal(openapi.components.schemas.entities.title, "Entity catalog");
    assert.equal(openapi.components.schemas.entities.properties.definition["x-exensial-ui"].control, "textarea");
    assert.equal(openapi.components.schemas.entities.properties.definition["x-exensial-ui"].tableHidden, true);
    assert.equal(openapi.components.schemas.entities.properties.code["x-exensial-ui"].control, "textarea");
    assert.equal(openapi.components.schemas.entities.properties.code["x-exensial-ui"].codeLanguage, "typescript");
    assert.equal(openapi.components.schemas.entities.properties.code["x-exensial-ui"].tableHidden, true);
    assert.match(openapi.components.schemas.entities.properties.name.description, /Final route segment/);
    const schema = openapi.components.schemas["documented-products"];
    assert.equal(schema.title, "Products");
    assert.equal(schema["x-exensial-localized"].title.es, "Productos");
    assert.equal(schema.properties.internalCode["x-exensial-ui"].hidden, true);
    assert.equal(schema.properties.price["x-exensial-ui"].control, "money");
    assert.deepEqual(schema.properties.categoryId["x-exensial-ui"].relation, { namespace: "catalog", entity: "categories", label: "name" });
    assert.ok(openapi.paths["/v1/documented-products"]);
    assert.ok(openapi.paths["/v1/auth/login"]);
    assert.equal(openapi.components.securitySchemes.bearerAuth.scheme, "bearer");
    const collection = openapi.paths["/v1/documented-products"];
    assert.equal(collection.get.operationId, "listDocumentedProducts");
    assert.match(collection.get.description, /Returns every record/);
    assert.equal(collection.post.requestBody.content["application/json"].examples.one.value.name, "Example name");
    assert.equal(collection.get.responses[200].content["application/json"].example[0].name, "Example name");
    assert.match(openapi.paths["/v1/documented-products/{id}"].patch.description, /Updates only the supplied fields/);
    assert.match(await (await fetch(`${baseUrl}/docs`)).text(), /SwaggerUIBundle/);
    const consolePage = await (await fetch(`${baseUrl}/console`)).text();
    const codeMirror = await fetch(`${baseUrl}/assets/codemirror.js?v=2`);
    assert.equal(codeMirror.status, 200);
    assert.match(codeMirror.headers.get("content-type") ?? "", /^application\/javascript/);
    assert.match(await codeMirror.text(), /^\/\/ CodeMirror/);
    assert.match(consolePage, /Runtime entity console/);
    assert.match(consolePage, /openapi\.json/);
    assert.match(consolePage, /exensial\.lastConsoleRoute/);
    assert.match(consolePage, /hashchange/);
    assert.match(consolePage, /lookup-dialog/);
    assert.match(consolePage, /Filter/);
    assert.match(consolePage, /applyUiStrings/);
    assert.match(consolePage, /x-exensial-ui-localization/);
    assert.match(consolePage, /deleteConfirmation/);
    assert.match(consolePage, /confirm\(t\('deleteConfirmation','Delete this record\?'\)\)/);
    assert.match(consolePage, /response\.status===401&&!suppressLoginPrompt/);
    assert.match(consolePage, /state\.requireLogin=\(\)=>/);
    assert.match(consolePage, /sessionExpired/);
    assert.match(consolePage, /navigator\.language/);
    assert.match(consolePage, /t\('new','New'\)/);
    assert.match(consolePage, /type="checkbox"/);
    assert.match(consolePage, /CodeMirror/);
    assert.match(consolePage, /requestAnimationFrame\(setupCodeEditors\)/);
    assert.match(consolePage, /lineWrapping:true/);
    assert.match(consolePage, /#editor\.code-editor/);
    assert.match(consolePage, /codemirror-typescript\.js\?v=2/);
    assert.match(consolePage, /grid-checkbox/);
    assert.match(consolePage, /return value==='true'/);
    assert.match(consolePage, /auth-form/);
    assert.match(consolePage, /className='account'/);
    assert.match(consolePage, /function enhanceConsole/);
  });
});

test("advertises and executes the optional ExensialQuery capability", async () => {
  await withApi(async (baseUrl) => {
    const definition = `type Book = { /** @exensial.ui.searchable */ title: string; /** @exensial.ui.searchable */ author: string; /** @exensial.ui.filterable */ copies: number }`;
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "books", namespace: "library", definition }) });
    await fetch(`${baseUrl}/v1/library/books`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ title: "Dune", author: "Frank Herbert", copies: 2 }, { title: "Kindred", author: "Octavia Butler", copies: 1 }]) });
    const queried = await fetch(`${baseUrl}/v1/query/exensial/library/books?$filter=contains(title,%20'Dune')%20or%20contains(author,%20'Butler')&$top=1`);
    assert.equal(queried.status, 200);
    assert.equal(queried.headers.get("x-total-count"), "2");
    assert.equal((await queried.json()).length, 1);
    assert.equal((await fetch(`${baseUrl}/v1/query/exensial/library/books?$filter=contains(copies,%20'2')`)).status, 400);
    const openapi = await (await fetch(`${baseUrl}/openapi.json`)).json();
    assert.equal(openapi["x-exensial-capabilities"].query.exensialQuery.root, "/v1/query/exensial");
    assert.ok(openapi.paths["/v1/query/exensial/library/books"]);
  });
  await withApi(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/openapi.json`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/query/exensial/entities`)).status, 404);
  }, { enableExensialQuery: false });
});

test("applies runtime localizations to generated OpenAPI", async () => {
  await withApi(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "tasks", definition: "/** @exensial.title en Tasks */\ntype Task = { title: string }" }) });
    const localization = await fetch(`${baseUrl}/v1/localizations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ locale: "es", key: "entity.tasks.title", value: "Tareas" }, { locale: "es", key: "ui.save", value: "Guardar" }]) });
    assert.equal(localization.status, 201);
    const openapi = await (await fetch(`${baseUrl}/openapi.json?lang=es`)).json();
    assert.equal(openapi["x-exensial-language"], "es");
    assert.equal(openapi.components.schemas.tasks.title, "Tareas");
    assert.ok(openapi["x-exensial-locales"].includes("es"));
    assert.equal(openapi["x-exensial-ui-localization"]["ui.save"], "Guardar");
  });
});

test("installs a TypeScript domain module received through the entity endpoint", async () => {
  await withApi(async (baseUrl) => {
    const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    await post("/v1/entities", {
      name: "books", namespace: "coded-library",
      definition: "type Book = { title: string; copiesAvailable: number }"
    });
    const book = await (await post("/v1/coded-library/books", { title: "Runtime code", copiesAvailable: 1 })).json();
    const code = `
      type Context = {
        input?: Record<string, unknown>;
        current?: Record<string, unknown>;
        records: {
          get(name: string, id: string, namespace?: string): Record<string, unknown> | undefined;
          update(name: string, id: string, changes: Record<string, unknown>, namespace?: string): Promise<Record<string, unknown>>;
        };
        fail(message: string): never;
      };
      export default {
        create: async (context: Context, next: () => Promise<void>) => {
          const input = context.input!;
          input.memberId = String(input.memberId).trim().toLowerCase();
          const book = context.records.get("books", String(input.bookId), "coded-library");
          if (!book || Number(book.copiesAvailable) < 1) context.fail("Book is not available");
          await context.records.update("books", String(input.bookId), { copiesAvailable: Number(book.copiesAvailable) - 1 }, "coded-library");
          delete input.returnedAt;
          input.status = "active";
          await next();
        },
        update: async (context: Context, next: () => Promise<void>) => {
          if (context.current?.status !== "active" || context.input?.status !== "returned") context.fail("Only active loans may be returned");
          await next();
          const book = context.records.get("books", String(context.current?.bookId), "coded-library")!;
          await context.records.update("books", String(book.id), { copiesAvailable: Number(book.copiesAvailable) + 1 }, "coded-library");
        }
      };
    `;
    const definition = await post("/v1/entities", {
      name: "loans", namespace: "coded-library",
      definition: "type Loan = { bookId: string; memberId: string; returnedAt?: string; status?: string }",
      code
    });
    assert.equal(definition.status, 201);
    const loanResponse = await post("/v1/coded-library/loans", { bookId: book.id, memberId: " ANA ", returnedAt: "2026-10-12T10:00:00.000Z" });
    const loan = await loanResponse.json();
    assert.equal(loanResponse.status, 201);
    assert.deepEqual({ memberId: loan.memberId, status: loan.status }, { memberId: "ana", status: "active" });
    assert.equal("returnedAt" in loan, false);
    assert.equal((await (await fetch(`${baseUrl}/v1/coded-library/books/${book.id}`)).json()).copiesAvailable, 0);
    assert.equal((await post("/v1/coded-library/loans", { bookId: book.id, memberId: "mateo" })).status, 400);
    assert.equal((await fetch(`${baseUrl}/v1/coded-library/loans/${loan.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "returned" })
    })).status, 200);
    assert.equal((await (await fetch(`${baseUrl}/v1/coded-library/books/${book.id}`)).json()).copiesAvailable, 1);
  });
});

test("uses localized runtime failures and can assign a server-side timestamp", async () => {
  await withApi(async (baseUrl) => {
    const post = (path: string, body: unknown, language = "en") => fetch(`${baseUrl}${path}`, {
      method: "POST", headers: { "content-type": "application/json", "accept-language": language }, body: JSON.stringify(body)
    });
    await post("/v1/localizations", [{
      locale: "es", key: "library.loans.error.activeCannotDelete", value: "Los préstamos activos no se pueden eliminar."
    }]);
    const definition = await post("/v1/entities", {
      name: "loans", namespace: "localized-library",
      definition: "type Loan = { borrowedAt?: string; status?: string }",
      code: `export default {
        create: async (context, next) => { context.input.borrowedAt ??= new Date().toISOString(); context.input.status = "active"; await next(); },
        delete: async (context) => { if (context.current.status === "active") context.fail("library.loans.error.activeCannotDelete", "Active loans cannot be deleted"); }
      }`
    });
    assert.equal(definition.status, 201);
    const loanResponse = await post("/v1/localized-library/loans", {});
    const loan = await loanResponse.json();
    assert.equal(loanResponse.status, 201);
    assert.ok(Number.isFinite(Date.parse(loan.borrowedAt)));
    const deletion = await fetch(`${baseUrl}/v1/localized-library/loans/${loan.id}?lang=es`, {
      method: "DELETE", headers: { "accept-language": "es" }
    });
    assert.equal(deletion.status, 400);
    assert.equal((await deletion.json()).error, "Los préstamos activos no se pueden eliminar.");
  });
});

test("supports domain-enforced unique relation associations", async () => {
  await withApi(async (baseUrl) => {
    const post = (path: string, body: unknown, language = "en") => fetch(`${baseUrl}${path}`, {
      method: "POST", headers: { "content-type": "application/json", "accept-language": language }, body: JSON.stringify(body)
    });
    await post("/v1/localizations", [{ locale: "es", key: "library.members.error.userAlreadyAssigned", value: "Un usuario solo puede estar asociado a un miembro." }]);
    await post("/v1/entities", {
      name: "members", namespace: "unique-library", definition: "type Member = { name: string; user?: string }",
      code: `export default { create: async (context, next) => {
        if (context.input.user && context.collection("members", "unique-library").findBy("user", context.input.user).length) {
          context.fail("library.members.error.userAlreadyAssigned", "A user can be associated with only one member");
        }
        await next();
      } }`
    });
    assert.equal((await post("/v1/unique-library/members", { name: "Ana", user: "user-1" })).status, 201);
    const duplicate = await post("/v1/unique-library/members", { name: "Mateo", user: "user-1" }, "es");
    assert.equal(duplicate.status, 400);
    assert.equal((await duplicate.json()).error, "Un usuario solo puede estar asociado a un miembro.");
  });
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

test("can disable the entity catalog layer", async () => {
  await withApi(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/v1/entities`)).status, 404);
  }, { enableEntityCatalog: false });
});
