import type { EntityDefinition, FieldDefinition, LocalizedText, ScalarType } from "./domain/entity";

type Schema = Record<string, unknown>;

/** Builds an OpenAPI document from the entities that are installed right now. */
export function createOpenApi(definitions: EntityDefinition[]): Record<string, unknown> {
  const schemas = Object.fromEntries(definitions.map((definition) => [schemaKey(definition), entitySchema(definition)]));
  const paths = Object.assign({}, ...definitions.map((definition) => entityPaths(definition)));
  return {
    openapi: "3.0.4",
    info: {
      title: "Exensial API",
      version: "1.0.0",
      description: entityCatalogGuide()
    },
    paths,
    components: { schemas }
  };
}

function entitySchema(definition: EntityDefinition): Schema {
  const properties = Object.fromEntries([
    ["id", { type: "string", format: "uuid", readOnly: true }],
    ...Object.entries(definition.fields).map(([name, field]) => [name, fieldSchema(field)])
  ]);
  return {
    type: "object",
    title: text(definition.documentation?.title) ?? definition.name,
    description: text(definition.documentation?.description),
    "x-exensial-localized": definition.documentation,
    "x-exensial-context": definition.context,
    properties,
    required: ["id", ...Object.entries(definition.fields).filter(([, field]) => field.required).map(([name]) => name)]
  };
}

function fieldSchema(field: FieldDefinition): Schema {
  return {
    ...scalarSchema(field.type),
    title: text(field.documentation?.title),
    description: text(field.documentation?.description),
    "x-exensial-localized": field.documentation
  };
}

function scalarSchema(type: ScalarType): Schema {
  if (type === "json") return {};
  return { type };
}

function entityPaths(definition: EntityDefinition): Record<string, unknown> {
  const reference = { $ref: `#/components/schemas/${schemaKey(definition)}` };
  const namespace = definition.context?.namespace;
  const collectionPath = `/v1/${namespace ? `${namespace}/` : ""}${definition.name}`;
  const itemPath = `${collectionPath}/{id}`;
  const input = inputExample(definition);
  const record = { id: exampleId(), ...input };
  const bulkInput = [input, inputExample(definition, 2)];
  const partialInput = partialExample(definition);
  return {
    [collectionPath]: {
      get: operation(definition, "list", `List ${definition.name}`, "Returns every record currently held by this entity.", {
        200: { description: "Collection returned", content: jsonContent({ type: "array", items: reference }, [record]) }
      }),
      post: operation(definition, "create", `Create or import ${definition.name}`, "Send one object to create one record, or an array of objects to import records in bulk.", {
        201: {
          description: "Record or bulk import created",
          content: jsonContent({ oneOf: [reference, { type: "object", properties: { items: { type: "array", items: reference } }, required: ["items"] }] }, record)
        },
        400: validationErrorResponse()
      }, jsonExamples({ oneOf: [reference, { type: "array", items: reference }] }, {
        one: { summary: "Create one record", value: input },
        many: { summary: "Import multiple records", value: bulkInput }
      }))
    },
    [itemPath]: {
      parameters: [{ name: "id", in: "path", required: true, description: "Record identifier returned by a create operation.", schema: { type: "string", format: "uuid" }, example: exampleId() }],
      get: operation(definition, "get", `Get ${definition.name}`, "Returns one record by id.", { 200: { description: "Record returned", content: jsonContent(reference, record) }, 404: errorResponse() }),
      put: operation(definition, "replace", `Replace ${definition.name}`, "Replaces a record. Include every required field declared by the entity.", {
        200: { description: "Record replaced", content: jsonContent(reference, record) }, 400: validationErrorResponse(), 404: errorResponse()
      }, jsonContent(reference, input)),
      patch: operation(definition, "update", `Update ${definition.name}`, "Updates only the supplied fields; required fields may be omitted.", {
        200: { description: "Record updated", content: jsonContent(reference, { ...record, ...partialInput }) }, 400: validationErrorResponse(), 404: errorResponse()
      }, jsonContent(reference, partialInput)),
      delete: operation(definition, "delete", `Delete ${definition.name}`, "Permanently removes one record by id.", { 204: { description: "Record deleted" }, 404: errorResponse() })
    }
  };
}

function operation(
  definition: EntityDefinition,
  action: string,
  summary: string,
  detail: string,
  responses: Record<string | number, unknown>,
  requestContent?: Schema
): Schema {
  return {
    tags: [schemaKey(definition)],
    operationId: `${action}${identifier(schemaKey(definition))}`,
    summary,
    description: [text(definition.documentation?.description), detail].filter(Boolean).join("\n\n"),
    ...(requestContent ? { requestBody: { required: true, content: requestContent } } : {}),
    responses
  };
}

function jsonContent(schema: Schema, example?: unknown): Schema {
  return { "application/json": { schema, ...(example === undefined ? {} : { example }) } };
}
function jsonExamples(schema: Schema, examples: Record<string, { summary: string; value: unknown }>): Schema {
  return { "application/json": { schema, examples } };
}
function errorResponse(): Schema { return { description: "Record not found", content: jsonContent({ type: "object", properties: { error: { type: "string" } }, required: ["error"] }, { error: "Record not found" }) }; }
function validationErrorResponse(): Schema { return { description: "Request does not match the entity schema", content: jsonContent({ type: "object", properties: { error: { type: "string" } }, required: ["error"] }, { error: "Missing required field: title" }) }; }
function text(localized?: LocalizedText): string | undefined { return localized?.en ?? Object.values(localized ?? {})[0]; }
function schemaKey(definition: EntityDefinition): string { return definition.context?.namespace ? `${definition.context.namespace}.${definition.name}` : definition.name; }
function identifier(value: string): string { return value.replace(/[^a-zA-Z0-9]+(.)?/g, (_match, next?: string) => next?.toUpperCase() ?? "").replace(/^./, (first) => first.toUpperCase()); }

function inputExample(definition: EntityDefinition, index = 1): Record<string, unknown> {
  return Object.fromEntries(Object.entries(definition.fields).map(([name, field]) => [name, fieldExample(name, field, index)]));
}

function partialExample(definition: EntityDefinition): Record<string, unknown> {
  const [name, field] = Object.entries(definition.fields)[0] ?? [];
  return name && field ? { [name]: fieldExample(name, field, 2) } : {};
}

function fieldExample(name: string, field: FieldDefinition, index: number): unknown {
  if (field.type === "number") return index === 1 ? 42 : 84;
  if (field.type === "boolean") return index % 2 === 1;
  if (field.type === "json") return { example: true, sequence: index };
  if (name.endsWith("At")) return "2026-10-12T12:00:00.000Z";
  if (name.toLowerCase().includes("email")) return "person@example.com";
  if (name === "apiVersion") return "v1";
  if (name === "action") return "create";
  if (name === "entityName") return "tasks";
  if (name === "namespace") return "acme.work";
  if (name === "definition") return "type Task = { title: string; completed?: boolean }";
  return `Example ${name}${index === 1 ? "" : ` ${index}`}`;
}

function exampleId(): string { return "550e8400-e29b-41d4-a716-446655440000"; }

function entityCatalogGuide(): string {
  return `## Start here: define a collection, then create records

An **entity definition** describes which JSON fields a collection accepts. It does not create a book, task, or other record by itself. Send the definition to **POST /v1/entities**, then use the route that Exensial creates for the actual records.

### 1. Define an entity

This creates a namespaced task collection. The type alias is a string because it is data sent over HTTP.

\`\`\`json
{
  "name": "tasks",
  "namespace": "acme.work",
  "definition": "type Task = { title: string; completed?: boolean }"
}
\`\`\`

### 2. Create and read records

After the definition succeeds, create a record at the generated collection route:

\`\`\`text
POST /v1/acme.work/tasks
{ "title": "Prepare the demo", "completed": false }

201 Created
{ "id": "<generated-id>", "title": "Prepare the demo", "completed": false }
\`\`\`

Use that returned \`id\` with \`GET /v1/acme.work/tasks/{id}\`, \`PATCH /v1/acme.work/tasks/{id}\`, or \`DELETE /v1/acme.work/tasks/{id}\`.

### How a route is chosen

| Definition | Collection route | Item route |
| --- | --- | --- |
| \`{ "name": "tasks" }\` | \`/v1/tasks\` | \`/v1/tasks/{id}\` |
| \`{ "name": "tasks", "namespace": "acme.work" }\` | \`/v1/acme.work/tasks\` | \`/v1/acme.work/tasks/{id}\` |

The namespace is optional, but when present it is always the segment immediately after the API version. The pair of namespace and name identifies an entity, so two namespaces may both contain \`tasks\`.

### CRUD behavior

- **GET collection** lists records.
- **POST collection with an object** creates one record.
- **POST collection with an array** imports several records.
- **GET item** reads one record by id.
- **PUT item** replaces it and requires every required field.
- **PATCH item** changes only the submitted fields.
- **DELETE item** removes it and returns \`204 No Content\`.

The operations below include generated request and response examples based on each entity's current fields. Read those examples as the exact shape accepted by the active schema.

### Documentation and localization

Add JSDoc with \`@exensial.title <locale> <text>\` and \`@exensial.description <locale> <text>\` before the type or a field. Swagger uses English when available and preserves all locales in \`x-exensial-localized\`.

\`\`\`ts
/**
 * @exensial.title en Tasks
 * @exensial.title es Tareas
 * @exensial.description en Work tracked by a team
 */
type Task = {
  /** @exensial.description en A concise task summary */
  title: string;
  completed?: boolean;
}
\`\`\`

### Business logic

\`module\` is optional. It selects a **trusted behavior module already registered by the application**; it is not JavaScript sent by the client. A module can run before and after \`create\`, \`bulkCreate\`, \`list\`, \`get\`, \`replace\`, \`update\`, or \`delete\`.

\`\`\`ts
const normalizeTitle: EntityBehaviorModule = {
  id: "library/normalize-title",
  operations: {
    create: async (context, next) => {
      const input = context.input as Record<string, unknown>;
      input.title = String(input.title).trim(); // before CRUD
      await next();                             // generic repository CRUD
      // context.result is available after CRUD
    }
  }
};
\`\`\`

Call \`await next()\` to continue to generic CRUD. Do not call it when the module intentionally replaces generic CRUD; in that case it must assign \`context.result\` itself. Select this module while defining an entity with \`"module": "library/normalize-title"\`. An unknown module id is rejected, and code received over HTTP is never executed.

### Runtime-configured reservation workflow

The built-in \`exensial/availability-reservation\` module is a reusable example. Set its \`behavior\` object to name the resource entity, reference field, availability field, status values, and date rules. For a loan entity it can reject blank ids, invalid or misordered dates, missing books, and unavailable books; it marks the book unavailable when a loan is created and available again when that loan is returned. The full configuration and request examples are in the entity authoring guide.`;
}
