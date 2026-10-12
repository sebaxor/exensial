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
  return {
    [collectionPath]: {
      get: operation(`List ${definition.name}`, definition, { 200: { description: "Collection", content: jsonContent({ type: "array", items: reference }) } }),
      post: operation(`Create or import ${definition.name}`, definition, {
        201: { description: "Created", content: jsonContent({ oneOf: [reference, { type: "object", properties: { items: { type: "array", items: reference } }, required: ["items"] }] }) }
      }, { oneOf: [reference, { type: "array", items: reference }] })
    },
    [itemPath]: {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: operation(`Get ${definition.name}`, definition, { 200: { description: "Record", content: jsonContent(reference) }, 404: errorResponse() }),
      put: operation(`Replace ${definition.name}`, definition, { 200: { description: "Replaced", content: jsonContent(reference) }, 404: errorResponse() }, reference),
      patch: operation(`Update ${definition.name}`, definition, { 200: { description: "Updated", content: jsonContent(reference) }, 404: errorResponse() }, reference),
      delete: operation(`Delete ${definition.name}`, definition, { 204: { description: "Deleted" }, 404: errorResponse() })
    }
  };
}

function operation(summary: string, definition: EntityDefinition, responses: Record<string | number, unknown>, requestSchema?: Schema): Schema {
  return {
    tags: [definition.name],
    summary,
    description: text(definition.documentation?.description),
    ...(requestSchema ? { requestBody: { required: true, content: jsonContent(requestSchema) } } : {}),
    responses
  };
}

function jsonContent(schema: Schema): Schema { return { "application/json": { schema } }; }
function errorResponse(): Schema { return { description: "Not found", content: jsonContent({ type: "object", properties: { error: { type: "string" } }, required: ["error"] }) }; }
function text(localized?: LocalizedText): string | undefined { return localized?.en ?? Object.values(localized ?? {})[0]; }
function schemaKey(definition: EntityDefinition): string { return definition.context?.namespace ? `${definition.context.namespace}.${definition.name}` : definition.name; }

function entityCatalogGuide(): string {
  return `## Dynamic entities

Use **POST /v1/entities** to turn a TypeScript type alias into a REST resource. For example:

\`\`\`json
{
  "name": "tasks",
  "namespace": "acme.work",
  "definition": "type Task = { title: string; completed?: boolean }"
}
\`\`\`

This publishes \`GET/POST /v1/acme.work/tasks\` and \`GET/PUT/PATCH/DELETE /v1/acme.work/tasks/{id}\`. Omit \`namespace\` to publish \`/v1/tasks\` instead.

### Documentation and localization

Add JSDoc with \`@exensial.title <locale> <text>\` and \`@exensial.description <locale> <text>\` before the type or a field. Swagger uses English when available and preserves all locales in \`x-exensial-localized\`.

### Business logic

\`module\` accepts only trusted module ids registered by the server. Modules can intercept \`create\`, \`bulkCreate\`, \`list\`, \`get\`, \`replace\`, \`update\`, and \`delete\`. Use \`await next()\` to extend base CRUD; omit it and assign \`context.result\` to replace it. HTTP never executes submitted code.`;
}
